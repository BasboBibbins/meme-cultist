const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { resolveMusicContext } = require("../../utils/musicGuards");
const { setPaused } = require("../../utils/musicControls");
const { buildInfoEmbed, buildErrorEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Pause the current song."),

  async execute(interaction) {
    const { queue, failed } = await resolveMusicContext(interaction);
    if (failed) return;

    if (queue.node.isPaused()) {
      return interaction.reply({
        embeds: [buildErrorEmbed(interaction.user, interaction.client, "The music is already paused. Use `/resume` to continue.")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await setPaused(queue, true);
    return interaction.reply({
      embeds: [buildInfoEmbed(interaction.user, interaction.client, `⏸️ Paused **${queue.currentTrack.title}**.`)],
    });
  },
};
