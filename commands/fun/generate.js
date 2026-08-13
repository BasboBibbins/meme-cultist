const { SlashCommandBuilder, AttachmentBuilder, MessageFlags } = require("discord.js");
const logger = require("../../utils/logger");
const { generateImage } = require("../../utils/llm");
const { canGenerateImage } = require("../../utils/ratelimiter");
const { isChatbotChannel, formatChatbotChannelMentions } = require("../../utils/channels");
const { buildErrorEmbed, buildInfoEmbed, COLORS } = require("../../utils/embeds");

function parseCloudflareError(err) {
  try {
    const json = JSON.parse(err.message);
    const raw = json?.errors?.[0]?.message ?? err.message;
    return raw.replace(/AiError:\s*/gi, "").replace(/\s*\([a-f0-9-]{36}\).*/, "").trim();
  } catch {
    const match = err.message.match(/AiError: (?!AiError)(.+)/);
    return match
      ? match[1].replace(/\s*\([a-f0-9-]{36}\).*/, "").trim()
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

    if (!isChatbotChannel(interaction.channelId, interaction.channel?.parentId)) {
      return interaction.reply({
        embeds: [buildInfoEmbed(interaction.user, interaction.client, `Image generation is only available in chatbot channels: ${formatChatbotChannelMentions(interaction.client)}`, COLORS.warning)
          .setTitle("Not Available")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    const rateCheck = canGenerateImage(interaction.user.id);
    if (!rateCheck.allowed) {
      return interaction.editReply({
        embeds: [buildInfoEmbed(interaction.user, interaction.client, rateCheck.reason, COLORS.warning).setTitle("Rate Limited")],
      });
    }

    try {
      const { buffer, mimeType } = await generateImage({ prompt });
      const ext = mimeType?.includes("png") ? "png" : "jpg";
      const fileName = `generated.${ext}`;
      const attachment = new AttachmentBuilder(buffer).setName(fileName);

      await interaction.editReply({
        embeds: [buildInfoEmbed(interaction.user, interaction.client, prompt)
          .setAuthor({ name: `Requested by ${interaction.user.displayName}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
          .setImage(`attachment://${fileName}`)],
        files: [attachment],
      });
    } catch (err) {
      logger.error(`[/generate] ${err.message}`);
      await interaction.editReply({
        embeds: [buildErrorEmbed(interaction.user, interaction.client, parseCloudflareError(err)).setTitle("Error")],
      });
    }
  }
};
