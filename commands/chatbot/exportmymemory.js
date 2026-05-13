const { SlashCommandBuilder, AttachmentBuilder } = require("discord.js");
const { getUserChatbotData } = require("../../utils/openai");
const logger = require("../../utils/logger");

function todayStamp() {
    const d = new Date();
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("exportmymemory")
        .setDescription("DM yourself a JSON dump of everything the chatbot has stored about you."),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

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

        try {
            const dm = await interaction.user.createDM();
            await dm.send({
                content: `Here's everything the chatbot remembers about you. Use \`/forget <fact_key>\` to remove specific facts, or \`/incognito\` to stop accumulating memory.`,
                files: [attachment],
            });
            logger.log(`[ExportMemory] DM sent to ${interaction.user.tag}`);
            return interaction.editReply({ content: "Check your DMs — I sent you a JSON file." });
        } catch (err) {
            logger.warn(`[ExportMemory] DM failed for ${interaction.user.tag}: ${err.message}. Falling back to ephemeral reply.`);
            return interaction.editReply({
                content: "I couldn't DM you (DMs disabled?). Here's your export inline:",
                files: [attachment],
            });
        }
    },
};
