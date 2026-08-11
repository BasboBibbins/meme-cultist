const { SlashCommandBuilder } = require("discord.js");
const { resolveMusicContext } = require("../../utils/musicGuards");
const { stopPlayback } = require("../../utils/musicControls");
const { buildInfoEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop playback and clear the queue."),

  async execute(interaction) {
    const { queue, failed } = await resolveMusicContext(interaction, { requireTrack: false });
    if (failed) return;

    await stopPlayback(queue);
    return interaction.reply({
      embeds: [buildInfoEmbed(interaction.user, interaction.client, "⏹️ Playback stopped and the queue was cleared.")],
    });
  },
};
