const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { randomHexColor } = require("../../utils/randomcolor");


module.exports = {
  data: new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Embed an image.")
    .addAttachmentOption(option =>
      option.setName('image')
        .setDescription('The image to embed.')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('title')
        .setDescription('The title of the embed.')
        .setRequired(false)),
  async execute(interaction) {
    const image = interaction.options.getAttachment('image');
    const user = interaction.options.getUser('user') || interaction.user;
    const title = interaction.options.getString('title') || interaction.user.username;
    let accentColor = user.hexAccentColor ? user.hexAccentColor : randomHexColor();

    const embed = new EmbedBuilder()
      .setAuthor({ name: title, iconURL: user.displayAvatarURL({ dynamic: true }) })
      .setColor(accentColor)
      .setImage(image.url)
      .setTimestamp()
      .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) });
    await interaction.reply({ embeds: [embed] });
  }   
}