const { SlashCommandBuilder } = require("discord.js");
const { randomHexColor } = require("../../utils/randomcolor");
const { buildInfoEmbed } = require("../../utils/embeds");


module.exports = {
  data: new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Embed an image.")
    .addAttachmentOption(option =>
      option.setName("image")
        .setDescription("The image to embed.")
        .setRequired(true))
    .addStringOption(option =>
      option.setName("title")
        .setDescription("The title of the embed.")
        .setRequired(false)),
  async execute(interaction) {
    const image = interaction.options.getAttachment("image");
    const user = interaction.options.getUser("user") || interaction.user;
    const title = interaction.options.getString("title") || interaction.user.displayName ;
    const accentColor = user.hexAccentColor ? user.hexAccentColor : randomHexColor();

    const embed = buildInfoEmbed(user, interaction.client, undefined, accentColor)
      .setAuthor({ name: title, iconURL: user.displayAvatarURL({ dynamic: true }) })
      .setImage(image.url);
    await interaction.reply({ embeds: [embed] });
  }   
};