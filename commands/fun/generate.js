const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require("discord.js");
const logger = require("../../utils/logger");
const { randomHexColor } = require("../../utils/randomcolor");
const { generateImage } = require("../../utils/gemini");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("generate")
    .setDescription("Generate an image with Gemini.")
    .addStringOption(option =>
      option.setName("prompt")
        .setDescription("Describe the image to generate.")
        .setRequired(true)
        .setMaxLength(1000)
    ),
  async execute(interaction) {
    const prompt = interaction.options.getString("prompt");
    await interaction.deferReply();

    try {
      const { buffer, mimeType } = await generateImage(prompt);
      const ext = mimeType?.includes("png") ? "png" : "jpg";
      const fileName = `generated.${ext}`;
      const attachment = new AttachmentBuilder(buffer).setName(fileName);

      const embed = new EmbedBuilder()
        .setAuthor({ name: `Requested by ${interaction.user.displayName}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
        .setColor(randomHexColor())
        .setDescription(prompt)
        .setImage(`attachment://${fileName}`)
        .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], files: [attachment] });
    } catch (err) {
      logger.error(`[/generate] ${err.message}`);
      const embed = new EmbedBuilder()
        .setTitle('Error')
        .setDescription('Image generation failed. Please try again later.')
        .setColor(0xff0000)
        .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    }
  }
};
