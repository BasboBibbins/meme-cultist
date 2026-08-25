const { SlashCommandBuilder } = require("discord.js");
const { resolveMusicContext } = require("../../utils/music/guards");
const { stopPlayback } = require("../../utils/music/controls");
const { musicEmbed } = require("../../utils/music/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop playback and clear the queue."),

  async execute(interaction) {
    const { queue, failed } = await resolveMusicContext(interaction, { requireTrack: false });
    if (failed) return;

    const dropped = queue.tracks?.size ?? 0;
    await stopPlayback(queue);
    const tail = dropped > 0 ? ` ${dropped} queued track${dropped === 1 ? "" : "s"} went with it.` : "";
    return interaction.reply({
      embeds: [await musicEmbed(interaction, `⏹️ Playback stopped and the queue is clear.${tail}`)],
    });
  },
};
