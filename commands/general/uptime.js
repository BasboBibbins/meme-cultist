const { SlashCommandBuilder } = require("discord.js");
const { formatTimeSince } = require("../../utils/time");
const { buildInfoEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("uptime")
    .setDescription("Check the uptime of the bot."),
  async execute(interaction) {
    const startTimestamp = Date.now() - interaction.client.uptime;
    const uptime = await formatTimeSince(startTimestamp);
    const user = interaction.user;
    const embed = buildInfoEmbed(user, interaction.client)
      .addFields({ name: "Uptime", value: uptime, inline: true });
    await interaction.reply({embeds: [embed]});
  }
};