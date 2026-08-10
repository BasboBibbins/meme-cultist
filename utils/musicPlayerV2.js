// Components V2 prototype of the now-playing panel, kept alongside the embed
// version rather than replacing it. utils/musicPlayer.js is untouched and remains
// the fallback: swapping the trackStart/trackEnd import in bot.js reverts this.
//
// Interaction handling mirrors the embed panel deliberately, so a side-by-side
// comparison isolates rendering rather than behaviour. Known parity item: `msg`
// is a module-level singleton here too, so only one guild shows a panel at a time.

const wait = require("util").promisify(setTimeout);
const { MessageFlags } = require("discord.js");
const logger = require("./logger");
const { remainingMs, queueString } = require("./musicPlayer");
const { buildNowPlayingV2 } = require("./musicPanelV2");

let msg = null;

const PROGRESS_REFRESH_MS = 7000;
const PAUSED_COLLECTOR_MS = 300000;
const IDLE_GRACE_MS = 30000;

module.exports = {
  currentTrack: null,

  trackStart: async (client, queue, track) => {
    if (msg != null) return;

    const channel = queue.metadata.channel;
    const requestedBy = queue.metadata.requestedBy;
    module.exports.currentTrack = track;

    const render = (paused = false) => buildNowPlayingV2({ track, queue, requestedBy, client, paused });

    msg = await channel.send(render(false));

    // Every V2 edit resends the whole component tree and the flag — there is no partial update equivalent to embed.setDescription().
    const interval = setInterval(async () => {
      if (!queue.node.isPlaying() || queue.node.isPaused() || track.isStream) return clearInterval(interval);
      try {
        await msg.edit(render(false));
      } catch (err) {
        logger.warn(`[MusicV2] Progress update failed, stopping refresh: ${err.message}`);
        clearInterval(interval);
      }
    }, PROGRESS_REFRESH_MS);

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

        if (i.customId === "skip") {
          // The embed panel refused to skip while paused; resuming first is the fix.
          if (queue.node.isPaused()) await queue.node.resume();
          await queue.node.skip();
          if (msg) await msg.delete().catch(() => {});
          return collector.stop();
        }

        if (i.customId === "stop") {
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
      clearInterval(interval);
    });
  },

  trackEnd: async () => {
    msg = null;
    module.exports.currentTrack = null;
  },

  queueString,
};
