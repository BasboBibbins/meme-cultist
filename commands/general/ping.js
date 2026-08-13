const { SlashCommandBuilder } = require("discord.js");
const { buildInfoEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Pong!"),
  async execute(interaction) {
    await interaction.reply({ content: "Pinging..." });
    const sent = await interaction.fetchReply();
    const embed = buildInfoEmbed(
      interaction.user,
      interaction.client,
      `Latency is ${sent.createdTimestamp - interaction.createdTimestamp}ms.\n\nAPI Latency is ${Math.round(interaction.client.ws.ping)}ms.`
    ).setAuthor({ name: "Pong! 🏓", iconURL: interaction.user.displayAvatarURL({ dynamic: true }) });
    await interaction.editReply({ content: null, embeds: [embed] });
  }
};