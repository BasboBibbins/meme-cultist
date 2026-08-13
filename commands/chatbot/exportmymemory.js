const { SlashCommandBuilder, AttachmentBuilder, MessageFlags } = require("discord.js");
const { getUserChatbotData } = require("../../utils/openai");
const { sendDM } = require("../../utils/dm");
const logger = require("../../utils/logger");
const { todayStamp } = require("../../utils/time");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("exportmymemory")
    .setDescription("DM yourself a JSON dump of everything the chatbot has stored about you."),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const data = await getUserChatbotData(interaction.user.id);
    const dump = {
      exportedAt: new Date().toISOString(),
      userId: interaction.user.id,
      username: interaction.user.tag,
      chatbot: data || {},
    };
    const buffer = Buffer.from(JSON.stringify(dump, null, 2), "utf8");
    const filename = `memory-${interaction.user.id}-${todayStamp()}.json`;
    const attachment = new AttachmentBuilder(buffer).setName(filename);

    const dm = await sendDM(interaction.user, {
      content: "Here's everything the chatbot remembers about you. Use `/forget <fact_key>` to remove specific facts, or `/incognito` to stop accumulating memory.",
      files: [attachment],
    });
    if (dm) {
      logger.log(`[ExportMemory] DM sent to ${interaction.user.tag}`);
      return interaction.editReply({ content: "Check your DMs — I sent you a JSON file." });
    }
    logger.warn(`[ExportMemory] DM failed or disabled for ${interaction.user.tag}. Falling back to ephemeral reply.`);
    return interaction.editReply({
      content: "I couldn't DM you (DMs disabled or closed?). Here's your export inline:",
      files: [attachment],
    });
  },
};
