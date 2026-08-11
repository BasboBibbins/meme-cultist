// Components V2 prototype of the now-playing panel, kept alongside the embed
// version rather than replacing it. utils/musicPlayer.js is untouched and remains
// the fallback: swapping the trackStart/trackEnd import in bot.js reverts this.
//
// Known parity item: `msg` is a module-level singleton here too, so only one guild
// shows a panel at a time.

const wait = require("util").promisify(setTimeout);
const { MessageFlags } = require("discord.js");
const logger = require("./logger");
const { withLock } = require("./lock");
const { buildErrorEmbed } = require("./embeds");
const { remainingMs, queueString, progressBar } = require("./musicPlayer");
const { buildNowPlayingV2, resolveMusicColors } = require("./musicPanelV2");
const { isLooping, toggleLoop, restoreLoop, togglePause, skipTrack, stopPlayback } = require("./musicControls");

let msg = null;
let msgTrackUrl = null;
let progressTimer = null;
let collector = null;
let stopConfirmTimer = null;
let lastBar = null;

const PROGRESS_TICK_MS = 5000;
const PAUSED_COLLECTOR_MS = 300000;
const IDLE_GRACE_MS = 30000;
const STOP_CONFIRM_MS = 8000;

function clearProgressTimer() {
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = null;
  lastBar = null;
}

function clearStopConfirm() {
  if (stopConfirmTimer) clearTimeout(stopConfirmTimer);
  stopConfirmTimer = null;
}

// Discord allows roughly five message edits per five seconds per channel, and that
// budget is shared with every other command running in it. The bar is only a couple
// of dozen cells wide, so tick slowly and edit when a cell actually moves.
function startProgressTimer(panelMsg, queue, track, render) {
  clearProgressTimer();
  progressTimer = setInterval(async () => {
    if (msg !== panelMsg || !queue.node.isPlaying() || queue.node.isPaused() || track.isStream) return clearProgressTimer();
    if (stopConfirmTimer) return;

    const bar = progressBar(queue, track);
    if (bar === lastBar) return;
    lastBar = bar;

    try {
      await panelMsg.edit(render());
    } catch (err) {
      logger.warn(`[MusicV2] Progress update failed, stopping refresh: ${err.message}`);
      clearProgressTimer();
    }
  }, PROGRESS_TICK_MS);
}

async function destroyPanel(panelMsg) {
  clearProgressTimer();
  clearStopConfirm();
  if (panelMsg) await panelMsg.delete().catch(err => logger.warn(`[MusicV2] Panel delete failed: ${err.message}`));
  if (msg === panelMsg) {
    msg = null;
    msgTrackUrl = null;
  }
}

// A collector filter rejects silently, which Discord renders as "This interaction
// failed" — the rule has to be answered inside collect to read as a rule.
function inSameVoiceChannel(interaction, queue) {
  return interaction.member?.voice?.channelId === queue.channel?.id;
}

async function handleControl(interaction, panelMsg, queue, render, owner) {
  clearStopConfirm();

  if (interaction.customId === "pause") {
    const paused = await togglePause(queue);
    owner.resetTimer({ time: PAUSED_COLLECTOR_MS });
    lastBar = null;
    return interaction.editReply(render(paused));
  }

  if (interaction.customId === "loop") {
    toggleLoop(queue);
    lastBar = null;
    return interaction.editReply(render(queue.node.isPaused()));
  }

  if (interaction.customId === "skip") {
    await skipTrack(queue);
    await destroyPanel(panelMsg);
    return owner.stop();
  }

  if (interaction.customId === "stop") {
    await interaction.editReply(render(queue.node.isPaused(), { confirmStop: true }));
    stopConfirmTimer = setTimeout(async () => {
      stopConfirmTimer = null;
      if (msg !== panelMsg) return;
      await panelMsg.edit(render(queue.node.isPaused()))
        .catch(err => logger.warn(`[MusicV2] Stop confirm auto-revert failed: ${err.message}`));
    }, STOP_CONFIRM_MS);
    return;
  }

  if (interaction.customId === "stop_cancel") {
    lastBar = null;
    return interaction.editReply(render(queue.node.isPaused()));
  }

  if (interaction.customId === "stop_confirm") {
    await stopPlayback(queue);
    await destroyPanel(panelMsg);
    return owner.stop();
  }
}

// The collector is captured locally as well as stored: a later panel replaces the
// module reference, and an in-flight handler must still act on its own.
function attachCollector(panelMsg, queue, track, render) {
  const owner = panelMsg.createMessageComponentCollector({ time: remainingMs(queue, track) });
  collector = owner;

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
      await withLock(`musicv2:${queue.guild?.id ?? "unknown"}`, () => handleControl(i, panelMsg, queue, render, owner));
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
    clearStopConfirm();
    if (msg === panelMsg) clearProgressTimer();

    if (reason === "time" && queue.node.isPaused() && msg === panelMsg) {
      const reply = await panelMsg.reply("Still there? I'm killing this in 30 seconds if nobody speaks up.").catch(() => null);
      await wait(IDLE_GRACE_MS);
      if (queue.node.isPaused()) {
        await queue.node.stop().catch(err => logger.warn(`[MusicV2] Idle stop failed: ${err.message}`));
        await destroyPanel(panelMsg);
      }
      if (reply) await reply.delete().catch(err => logger.warn(`[MusicV2] Idle prompt cleanup failed: ${err.message}`));
      return;
    }

    // A looping track re-enters trackStart immediately and reattaches. Anything else
    // leaves buttons that no longer route anywhere, so take them away.
    if (msg === panelMsg && !isLooping(queue)) {
      await panelMsg.edit(render(queue.node.isPaused(), { controls: false }))
        .catch(err => logger.debug(`[MusicV2] Could not retire panel controls: ${err.message}`));
    }
  });
}

module.exports = {
  currentTrack: null,

  trackStart: async (client, queue, track) => {
    const requestedBy = queue.metadata.requestedBy;
    // Resolved once per track: the panel wears the requester's equipped theme, and
    // a DB read per refresh tick would be gratuitous.
    const colors = await resolveMusicColors(requestedBy?.id);
    const renderFor = panelTrack => (paused = false, opts = {}) =>
      buildNowPlayingV2({ track: panelTrack, queue, requestedBy, client, colors, paused, looping: isLooping(queue), ...opts });

    // TRACK repeat replays via PlayerFinish -> PlayerStart, so a looping song re-enters here each cycle; reuse the panel instead of posting one per repeat, and restart the refresh and collector the last cycle stopped.
    if (msg != null) {
      if (isLooping(queue) && msgTrackUrl === track.url) {
        const render = renderFor(track);
        startProgressTimer(msg, queue, track, () => render(false));
        if (!collector || collector.ended) attachCollector(msg, queue, track, render);
      }
      return;
    }

    const channel = queue.metadata.channel;
    module.exports.currentTrack = track;

    // Skip clears repeat to get past the current track; reapply it for the new one.
    restoreLoop(queue);

    const render = renderFor(track);
    msg = await channel.send(render(false));
    msgTrackUrl = track.url;

    startProgressTimer(msg, queue, track, () => render(false));
    attachCollector(msg, queue, track, render);
  },

  // Keeps the panel alive across a loop cycle; clearing it would post a fresh one.
  trackEnd: async (client, queue, track) => {
    if (isLooping(queue) && msgTrackUrl === track?.url) return;
    clearProgressTimer();
    clearStopConfirm();
    msg = null;
    msgTrackUrl = null;
    module.exports.currentTrack = null;
  },

  queueString,
};
