// Components V2 prototype of the now-playing panel, kept alongside the embed
// version rather than replacing it. utils/musicPlayer.js is untouched and remains
// the fallback: swapping the trackStart/trackEnd import in bot.js reverts this.
//
// Interaction handling mirrors the embed panel deliberately, so a side-by-side
// comparison isolates rendering rather than behaviour. Known parity item: `msg`
// is a module-level singleton here too, so only one guild shows a panel at a time.

const wait = require("util").promisify(setTimeout);
const { MessageFlags } = require("discord.js");
const { QueueRepeatMode } = require("discord-player");
const logger = require("./logger");
const { remainingMs, queueString } = require("./musicPlayer");
const { buildNowPlayingV2 } = require("./musicPanelV2");

let msg = null;
let msgTrackUrl = null;
let progressTimer = null;

// Loop intent held apart from queue.repeatMode, because skip has to switch the queue out of TRACK repeat briefly in order to advance at all.
let loopIntent = false;

const PROGRESS_REFRESH_MS = 1000;
const PAUSED_COLLECTOR_MS = 300000;
const IDLE_GRACE_MS = 30000;

function clearProgressTimer() {
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = null;
}

function startProgressTimer(queue, track, render) {
  clearProgressTimer();
  progressTimer = setInterval(async () => {
    if (!queue.node.isPlaying() || queue.node.isPaused() || track.isStream) return clearProgressTimer();
    try {
      await msg.edit(render());
    } catch (err) {
      logger.warn(`[MusicV2] Progress update failed, stopping refresh: ${err.message}`);
      clearProgressTimer();
    }
  }, PROGRESS_REFRESH_MS);
}

module.exports = {
  currentTrack: null,

  trackStart: async (client, queue, track) => {
    // TRACK repeat replays via PlayerFinish -> PlayerStart, so a looping song re-enters here each cycle; reuse the panel instead of posting one per repeat, and restart the refresh the last cycle stopped.
    if (msg != null) {
      if (loopIntent && msgTrackUrl === track.url) {
        const requestedBy = queue.metadata.requestedBy;
        startProgressTimer(queue, track, () =>
          buildNowPlayingV2({ track, queue, requestedBy, client, paused: false, looping: loopIntent }));
      }
      return;
    }

    const channel = queue.metadata.channel;
    const requestedBy = queue.metadata.requestedBy;
    module.exports.currentTrack = track;

    // Skip clears repeat to get past the current track; reapply it for the new one.
    if (loopIntent && queue.repeatMode !== QueueRepeatMode.TRACK) {
      queue.setRepeatMode(QueueRepeatMode.TRACK);
    }

    const render = (paused = false) =>
      buildNowPlayingV2({ track, queue, requestedBy, client, paused, looping: loopIntent });

    msg = await channel.send(render(false));
    msgTrackUrl = track.url;

    startProgressTimer(queue, track, () => render(false));

    const filter = i => i.member.voice.channelId === queue.channel.id;
    const collector = await msg.createMessageComponentCollector({ filter, time: remainingMs(queue, track) });

    collector.on("collect", async i => {
      logger.debug(`[MusicV2] ${i.member.user.displayName} pressed ${i.customId}`);

      try {
        if (i.customId === "pause") {
          if (queue.node.isPaused()) await queue.node.resume();
          else await queue.node.pause();
          await collector.resetTimer({ time: PAUSED_COLLECTOR_MS });
          return await i.update(render(queue.node.isPaused()));
        }

        if (i.customId === "loop") {
          loopIntent = !loopIntent;
          // TRACK repeats the current song and leaves queue.tracks untouched, so the queue survives and resumes in order once this is switched off.
          queue.setRepeatMode(loopIntent ? QueueRepeatMode.TRACK : QueueRepeatMode.OFF);
          logger.debug(`[MusicV2] Loop ${loopIntent ? "enabled" : "disabled"} for "${track.title}"`);
          return await i.update(render(queue.node.isPaused()));
        }

        if (i.customId === "skip") {
          if (queue.node.isPaused()) await queue.node.resume();
          // skip() ends the track through the same path that honours TRACK repeat, so leaving it on replays this song instead of advancing; trackStart reapplies it for the next track.
          if (queue.repeatMode === QueueRepeatMode.TRACK) queue.setRepeatMode(QueueRepeatMode.OFF);
          await queue.node.skip();
          if (msg) await msg.delete().catch(() => {});
          msg = null;
          msgTrackUrl = null;
          return collector.stop();
        }

        if (i.customId === "stop") {
          loopIntent = false;
          queue.setRepeatMode(QueueRepeatMode.OFF);
          await queue.node.stop();
          if (msg) await msg.delete().catch(() => {});
          return collector.stop();
        }
      } catch (err) {
        logger.error(`[MusicV2] Control "${i.customId}" failed: ${err.message}`);
        if (!i.replied && !i.deferred) {
          await i.reply({ content: "That control failed. Please try again.", flags: MessageFlags.Ephemeral }).catch(() => {});
        }
      }
    });

    collector.on("end", async (collected, reason) => {
      logger.debug(`[MusicV2] Collected ${collected.size} interactions. Reason: ${reason}`);
      if (reason === "time" && queue.node.isPaused()) {
        const reply = await msg.reply("Are you still there? Music will be stopped in 30 seconds if you don't respond.").catch(() => null);
        await wait(IDLE_GRACE_MS);
        if (queue.node.isPaused()) {
          await queue.node.stop().catch(() => {});
          if (msg) await msg.delete().catch(() => {});
        }
        if (reply) await reply.delete().catch(() => {});
      }
      clearProgressTimer();
    });
  },

  // Keeps the panel alive across a loop cycle; clearing it would post a fresh one.
  trackEnd: async (client, queue, track) => {
    if (loopIntent && msgTrackUrl === track?.url) return;
    msg = null;
    msgTrackUrl = null;
    module.exports.currentTrack = null;
  },

  queueString,
};
