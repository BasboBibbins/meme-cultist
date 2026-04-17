const { SlashCommandBuilder, AttachmentBuilder } = require("discord.js");
const logger = require("../../utils/logger");
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
      const attachment = new AttachmentBuilder(buffer).setName(`generated.${ext}`);
      await interaction.editReply({ content: prompt, files: [attachment] });
    } catch (err) {
      logger.error(`[/generate] ${err.message}`);
      await interaction.editReply({ content: `Image generation failed: ${err.message}` });
    }
  }
};
