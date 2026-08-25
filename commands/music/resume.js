const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { resolveMusicContext } = require("../../utils/music/guards");
const { setPaused } = require("../../utils/music/controls");
const { musicEmbed, musicErrorEmbed } = require("../../utils/music/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Resume the paused song."),

  async execute(interaction) {
    const { queue, failed } = await resolveMusicContext(interaction);
    if (failed) return;

    if (!queue.node.isPaused()) {
      return interaction.reply({
        embeds: [musicErrorEmbed(interaction, "It is already playing.")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await setPaused(queue, false);
    return interaction.reply({
      embeds: [await musicEmbed(interaction, `▶️ Resumed **${queue.currentTrack.title}**.`)],
    });
  },
};
