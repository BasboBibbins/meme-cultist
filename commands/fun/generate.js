const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require("discord.js");
const logger = require("../../utils/logger");
const { randomHexColor } = require("../../utils/randomcolor");
const { generateImage } = require("../../utils/gemini");
const { canGenerateImage } = require("../../utils/ratelimiter");

function parseCloudflareError(err) {
  try {
    const json = JSON.parse(err.message);
    const raw = json?.errors?.[0]?.message ?? err.message;
    return raw.replace(/AiError:\s*/gi, '').replace(/\s*\([a-f0-9-]{36}\).*/, '').trim();
  } catch {
    const match = err.message.match(/AiError: (?!AiError)(.+)/);
    return match
      ? match[1].replace(/\s*\([a-f0-9-]{36}\).*/, '').trim()
      : "Image generation failed. Please try again later.";
  }
}

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
/* 
    const rateCheck = canGenerateImage(interaction.user.id);
    if (!rateCheck.allowed) {
      const embed = new EmbedBuilder()
        .setTitle('Rate Limited')
        .setDescription(rateCheck.reason)
        .setColor(0xffaa00)
        .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    } */

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
      const desc = parseCloudflareError(err);
      const embed = new EmbedBuilder()
        .setTitle('Error')
        .setDescription(desc)
        .setColor(0xff0000)
        .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    }
  }
};
