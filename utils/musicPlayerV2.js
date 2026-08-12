// Components V2 prototype of the now-playing panel, kept alongside the embed
// version rather than replacing it. utils/musicPlayer.js is untouched and remains
// the fallback: swapping the trackStart/trackEnd import in bot.js reverts this.

const wait = require("util").promisify(setTimeout);
const { MessageFlags } = require("discord.js");
const logger = require("./logger");
const { withLock } = require("./lock");
const { buildErrorEmbed } = require("./embeds");
const { remainingMs, queueString, progressBar } = require("./musicPlayer");
const { buildNowPlayingV2, resolveMusicColors } = require("./musicPanelV2");
const { isLooping, toggleLoop, restoreLoop, togglePause, skipTrack, stopPlayback } = require("./musicControls");

const PROGRESS_TICK_MS = 5000;
const PAUSED_COLLECTOR_MS = 300000;
const IDLE_GRACE_MS = 30000;
const STOP_CONFIRM_MS = 8000;

// One panel per guild. Entries are reset rather than deleted, so a timer or collector
// still holding a state object keeps acting on the one it was started against.
const panels = new Map();

function panelState(guildId) {
  const key = guildId ?? "unknown";
  let state = panels.get(key);
  if (!state) {
    state = { msg: null, msgTrackUrl: null, progressTimer: null, collector: null, stopConfirmTimer: null, lastBar: null };
    panels.set(key, state);
  }
  return state;
}

function clearProgressTimer(state) {
  if (state.progressTimer) clearInterval(state.progressTimer);
  state.progressTimer = null;
  state.lastBar = null;
}

function clearStopConfirm(state) {
  if (state.stopConfirmTimer) clearTimeout(state.stopConfirmTimer);
  state.stopConfirmTimer = null;
}

// Discord allows roughly five message edits per five seconds per channel, and that
// budget is shared with every other command running in it. The bar is only a couple
// of dozen cells wide, so tick slowly and edit when a cell actually moves.
function startProgressTimer(state, panelMsg, queue, track, render) {
  clearProgressTimer(state);
  state.progressTimer = setInterval(async () => {
    if (state.msg !== panelMsg || !queue.node.isPlaying() || queue.node.isPaused() || track.isStream) return clearProgressTimer(state);
    if (state.stopConfirmTimer) return;

    const bar = progressBar(queue, track);
    if (bar === state.lastBar) return;
    state.lastBar = bar;

    try {
      await panelMsg.edit(render());
    } catch (err) {
      logger.warn(`[MusicV2] Progress update failed, stopping refresh: ${err.message}`);
      clearProgressTimer(state);
    }
  }, PROGRESS_TICK_MS);
}

async function destroyPanel(state, panelMsg) {
  clearProgressTimer(state);
  clearStopConfirm(state);
  if (panelMsg) await panelMsg.delete().catch(err => logger.warn(`[MusicV2] Panel delete failed: ${err.message}`));
  if (state.msg === panelMsg) {
    state.msg = null;
    state.msgTrackUrl = null;
  }
}

// A collector filter rejects silently, which Discord renders as "This interaction
// failed" — the rule has to be answered inside collect to read as a rule.
function inSameVoiceChannel(interaction, queue) {
  return interaction.member?.voice?.channelId === queue.channel?.id;
}

async function handleControl(interaction, state, panelMsg, queue, render, owner) {
  clearStopConfirm(state);

  if (interaction.customId === "pause") {
    const paused = await togglePause(queue);
    owner.resetTimer({ time: PAUSED_COLLECTOR_MS });
    state.lastBar = null;
    return interaction.editReply(render(paused));
  }

  if (interaction.customId === "loop") {
    toggleLoop(queue);
    state.lastBar = null;
    return interaction.editReply(render(queue.node.isPaused()));
  }

  if (interaction.customId === "skip") {
    await skipTrack(queue);
    await destroyPanel(state, panelMsg);
    return owner.stop();
  }

  if (interaction.customId === "stop") {
    await interaction.editReply(render(queue.node.isPaused(), { confirmStop: true }));
    state.stopConfirmTimer = setTimeout(async () => {
      state.stopConfirmTimer = null;
      if (state.msg !== panelMsg) return;
      await panelMsg.edit(render(queue.node.isPaused()))
        .catch(err => logger.warn(`[MusicV2] Stop confirm auto-revert failed: ${err.message}`));
    }, STOP_CONFIRM_MS);
    return;
  }

  if (interaction.customId === "stop_cancel") {
    state.lastBar = null;
    return interaction.editReply(render(queue.node.isPaused()));
  }

  if (interaction.customId === "stop_confirm") {
    await stopPlayback(queue);
    await destroyPanel(state, panelMsg);
    return owner.stop();
  }
}

// The collector is captured locally as well as stored: a later panel replaces the
// module reference, and an in-flight handler must still act on its own.
function attachCollector(state, panelMsg, queue, track, render) {
  const owner = panelMsg.createMessageComponentCollector({ time: remainingMs(queue, track) });
  state.collector = owner;

  owner.on("collect", async i => {
    logger.debug(`[MusicV2] ${i.member?.user?.displayName ?? "someone"} pressed ${i.customId}`);

    if (!inSameVoiceChannel(i, queue)) {
      return i.reply({
        embeds: [buildErrorEmbed(i.user, i.client, "Get in the voice channel if you want to touch the buttons.")],
        flags: MessageFlags.Ephemeral,
      }).catch(err => logger.warn(`[MusicV2] Out-of-voice notice failed: ${err.message}`));
    }

    // Ack before the lock: a queued caller must not burn the three-second window.
    try {
      await i.deferUpdate();
    } catch (err) {
      return logger.warn(`[MusicV2] Could not acknowledge "${i.customId}": ${err.message}`);
    }

    try {
      await withLock(`musicv2:${queue.guild?.id ?? "unknown"}`, () => handleControl(i, state, panelMsg, queue, render, owner));
    } catch (err) {
      logger.error(`[MusicV2] Control "${i.customId}" failed: ${err.message}`);
      await i.followUp({
        embeds: [buildErrorEmbed(i.user, i.client, "That button ate it. The song may already be gone — run `/np` for a fresh panel.")],
        flags: MessageFlags.Ephemeral,
      }).catch(() => logger.warn("[MusicV2] Could not deliver the control failure notice."));
    }
  });

  owner.on("end", async (collected, reason) => {
    logger.debug(`[MusicV2] Collected ${collected.size} interactions. Reason: ${reason}`);
    clearStopConfirm(state);
    if (state.msg === panelMsg) clearProgressTimer(state);

    if (reason === "time" && queue.node.isPaused() && state.msg === panelMsg) {
      const reply = await panelMsg.reply("Still there? I'm killing this in 30 seconds if nobody speaks up.").catch(() => null);
      await wait(IDLE_GRACE_MS);
      if (queue.node.isPaused()) {
        await queue.node.stop().catch(err => logger.warn(`[MusicV2] Idle stop failed: ${err.message}`));
        await destroyPanel(state, panelMsg);
      }
      if (reply) await reply.delete().catch(err => logger.warn(`[MusicV2] Idle prompt cleanup failed: ${err.message}`));
      return;
    }

    // A looping track re-enters trackStart immediately and reattaches. Anything else
    // leaves buttons that no longer route anywhere, so take them away.
    if (state.msg === panelMsg && !isLooping(queue)) {
      await panelMsg.edit(render(queue.node.isPaused(), { controls: false }))
        .catch(err => logger.debug(`[MusicV2] Could not retire panel controls: ${err.message}`));
    }
  });
}

module.exports = {
  trackStart: async (client, queue, track) => {
    const state = panelState(queue.guild?.id);
    const requestedBy = queue.metadata.requestedBy;
    // Resolved once per track: the panel wears the requester's equipped theme, and
    // a DB read per refresh tick would be gratuitous.
    const colors = await resolveMusicColors(requestedBy?.id);
    const renderFor = panelTrack => (paused = false, opts = {}) =>
      buildNowPlayingV2({ track: panelTrack, queue, requestedBy, client, colors, paused, looping: isLooping(queue), ...opts });

    // TRACK repeat replays via PlayerFinish -> PlayerStart, so a looping song re-enters here each cycle; reuse the panel instead of posting one per repeat, and restart the refresh and collector the last cycle stopped.
    if (state.msg != null) {
      if (isLooping(queue) && state.msgTrackUrl === track.url) {
        const render = renderFor(track);
        startProgressTimer(state, state.msg, queue, track, () => render(false));
        if (!state.collector || state.collector.ended) attachCollector(state, state.msg, queue, track, render);
      }
      return;
    }

    const channel = queue.metadata.channel;

    // Skip clears repeat to get past the current track; reapply it for the new one.
    restoreLoop(queue);

    const render = renderFor(track);
    state.msg = await channel.send(render(false));
    state.msgTrackUrl = track.url;

    startProgressTimer(state, state.msg, queue, track, () => render(false));
    attachCollector(state, state.msg, queue, track, render);
  },

  // Keeps the panel alive across a loop cycle; clearing it would post a fresh one.
  trackEnd: async (client, queue, track) => {
    const state = panelState(queue.guild?.id);
    if (isLooping(queue) && state.msgTrackUrl === track?.url) return;
    clearProgressTimer(state);
    clearStopConfirm(state);
    state.msg = null;
    state.msgTrackUrl = null;
  },

  queueString,
};
