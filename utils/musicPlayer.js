const { ButtonBuilder, ActionRowBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const wait = require("util").promisify(setTimeout);
const logger = require("../utils/logger");
const { buildInfoEmbed } = require("./embeds");

let msg = null;

// Fallback when a track's duration is unknown, which bridged sources report as 0.
const DEFAULT_COLLECTOR_MS = 600000;
const PROGRESS_REFRESH_MS = 7000;

// getTimestamp() is null until playback resolves (bridged Spotify reaches PlayerStart first), and `current` is {label,value} in ms — not seconds.
function remainingMs(queue, track) {
  const elapsed = queue.node.getTimestamp()?.current?.value ?? 0;
  const total = Number(track?.durationMS) || 0;
  const remaining = total - elapsed;
  return remaining > 0 ? remaining : DEFAULT_COLLECTOR_MS;
}

// createProgressBar() also returns null before playback resolves.
function progressBar(queue, track) {
  if (track?.isStream) return "🔴 LIVE";
  const bar = queue.node.createProgressBar();
  return bar ? `🔘 ${bar} 🔘` : "";
}

module.exports = {
  currentTrack: null,
  trackStart: async (client, queue, track) => {
    if (msg != null) return;

    const channel = queue.metadata.channel; 
    const requestedBy = queue.metadata.requestedBy; 
    module.exports.currentTrack = track;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("pause")
        .setLabel("Pause")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("⏸️"),
      new ButtonBuilder()
        .setCustomId("skip")
        .setLabel("Skip")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("⏭️"),
      new ButtonBuilder()
        .setCustomId("stop")
        .setLabel("Stop")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("⏹️")
    );

    const desc = `[${track.title}](${track.url})\nBy **${track.author}**${track.views > 0 ? ` | **${track.views}** views` : ""}`;
    let currentQueue = {};
    queue.tracks.map((track, index) => {
      currentQueue[index] = track;
    });

    const player = buildInfoEmbed(requestedBy, client, `${desc}\n\n${progressBar(queue, track)}\n\n${Object.keys(currentQueue).length > 0 ? `Up Next: [${currentQueue[0].title}](${currentQueue[0].url})\nBy **${currentQueue[0].author}**` : ""}`)
      .setTitle(`🎧 Now Playing${queue.channel ? ` in ${queue.channel.name}` : ""}`)
      .setAuthor({ name: `Requested by ${requestedBy.displayName}`, iconURL: requestedBy.displayAvatarURL({ dynamic: true }) })
      .setThumbnail(track.thumbnail);

    msg = await channel.send({ embeds: [player], components: [row] });

    const interval = setInterval(async () => {
      currentQueue = {};
      queue.tracks.map((track, index) => {
        currentQueue[index] = track;
      });

      if (!queue.node.isPlaying() || queue.node.isPaused() || track.isStream) return clearInterval(interval);

      player.setDescription(`${desc}\n\n${progressBar(queue, track)}${Object.keys(currentQueue).length > 0 ? `\n\nUp Next: [${currentQueue[0].title}](${currentQueue[0].url})\nBy **${currentQueue[0].author}**` : ""}`);
      try {
        await msg.edit({ embeds: [player], components: [row] });
      } catch (err) {
        logger.warn(`[Music] Progress update failed, stopping refresh: ${err.message}`);
        clearInterval(interval);
      }
      // Discord allows roughly five edits per five seconds per channel; a 1s refresh guarantees 429s.
    }, PROGRESS_REFRESH_MS);

    const filter = i => i.member.voice.channelId === queue.channel.id;
    const collector = await msg.createMessageComponentCollector({ filter, time: remainingMs(queue, track) });

    collector.on("collect", async i => {
      if (!filter) return await i.reply({ content: "Join the bot's channel to use these buttons!", flags: MessageFlags.Ephemeral });
      logger.debug(`${i.member.user.displayName} pressed ${i.customId}`);

      if (i.customId === "pause") {
        queue.node.isPaused() ? await queue.node.resume() : await queue.node.pause();
        await collector.resetTimer({ time: 300000 });

        player.setTitle(queue.node.isPaused() ? "⏸️ Song Paused" : `🎧 Now Playing${queue.channel ? ` in ${queue.channel.name}` : ""}`);
        row.components[0].setLabel(queue.node.isPaused() ? "Resume" : "Pause").setEmoji(queue.node.isPaused() ? "▶️" : "⏸️");
        row.components[1].setDisabled(queue.node.isPaused());

        await i.update({ embeds: [player], components: [row] });

      } else if (i.customId === "skip") {
        try {
          if (queue.node.isPaused()) {
            return await i.reply({ content: "Unpause before trying to skip. Too lazy to fix this bug for now.", flags: MessageFlags.Ephemeral });
          }
          await queue.node.skip(); 
          if (msg) await msg.delete();
          await collector.stop();
        } catch (e) {
          logger.error(e);
        }

      } else if (i.customId === "stop") {
        try {
          await queue.node.stop(); 
          if (msg) await msg.delete();
          return await collector.stop();
        } catch (e) {
          logger.error(e);
        }
      }
    });

    collector.on("end", async (collected, reason) => {
      logger.debug(`Collected ${collected.size} interactions. Reason: ${reason}`);
      if (reason === "time") {
        if (queue.node.isPaused()) {
          const reply = await msg.reply("Are you still there? Music will be stopped in 30 seconds if you don't respond.");
          await wait(30000);
          if (queue.node.isPaused()) {
            await queue.node.stop(); 
            if (msg) msg.delete();
            if (reply) await reply.delete();
          } else {
            if (reply) await reply.delete();
          }
        }
      }
      clearInterval(interval);
    });
  },

  trackEnd: async (client, queue, track) => {
    msg = null;
    module.exports.currentTrack = null;
  },

  queueString: (tracks) => {
    let result = tracks.map((track, i) =>
      `**${i + 1}.** [${track.title}](${track.url}) by **${track.author}** - ${track.duration}`
    ).join("\n");

    if (result.length > 3584) {
      result = result.substring(0, 3584);
      result = result.substring(0, result.lastIndexOf("\n"));
      result += "\n...";
    }

    return result;
  },

  remainingMs,
  progressBar,
  DEFAULT_COLLECTOR_MS,
};
