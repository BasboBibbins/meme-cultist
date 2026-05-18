const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getUserChatbotData, getThreadContext } = require("../../utils/openai");
const { randomHexColor } = require("../../utils/randomcolor");
const { MAX_FACTS_IN_PROMPT } = require("../../config.js");

function fmtTimestamp(ts) {
    if (!ts) return "unknown";
    return `<t:${Math.floor(ts / 1000)}:S>`;
}

function factLines(facts) {
    if (!facts || facts.length === 0) return ["_(none)_"];
    const sorted = [...facts].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return sorted.map(f => {
        const conf = f.confidence ? ` *[${f.confidence}]*` : "";
        const reinforced = f.reinforcedCount > 1 ? ` ×${f.reinforcedCount}` : "";
        const when = f.updatedAt ? ` — ${fmtTimestamp(f.updatedAt)}` : "";
        return `• **${f.key}**: ${f.value}${conf}${reinforced}${when}`;
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("whatdoyouknow")
        .setDescription("Show what the chatbot remembers.")
        .addStringOption(o =>
            o.setName("scope")
                .setDescription("Whose memory to show (default: yours).")
                .addChoices(
                    { name: "me", value: "me" },
                    { name: "channel", value: "channel" },
                )
                .setRequired(false)),

    async execute(interaction) {
        const scope = interaction.options.getString("scope") || "me";

        if (scope === "channel") {
            const ctx = await getThreadContext(interaction.channel);
            const facts = ctx?.facts || [];
            const summaries = ctx?.summaries || [];
            const lastSummary = summaries.length > 0 ? summaries[summaries.length - 1] : null;

            const embed = new EmbedBuilder()
                .setTitle(`Channel memory — #${interaction.channel.name}`)
                .setColor(randomHexColor())
                .addFields(
                    { name: `Facts (${facts.length})`, value: factLines(facts).slice(0, MAX_FACTS_IN_PROMPT || 15).join("\n").slice(0, 1024) || "_(none)_" },
                )
                .setFooter({ text: ctx?.persona_id ? `Persona pinned: id=${ctx.persona_id}` : "No persona pinned" });
            if (lastSummary) {
                embed.addFields({
                    name: `Latest summary ${fmtTimestamp(lastSummary.timestamp)}`,
                    value: (lastSummary.context || "").slice(0, 1024) || "_(empty)_",
                });
            }
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const data = await getUserChatbotData(interaction.user.id);
        const facts = data?.facts || [];
        const summaries = data?.summaries || [];
        const lastSummary = summaries.length > 0 ? summaries[summaries.length - 1] : null;

        const flags = [];
        if (data?.incognitoMode) flags.push("Global incognito");
        if (Array.isArray(data?.incognitoChannels) && data.incognitoChannels.length > 0) {
            flags.push(`${data.incognitoChannels.length} channel${data.incognitoChannels.length === 1 ? "" : "s"} incognito`);
        }

        const embed = new EmbedBuilder()
            .setAuthor({ name: `${interaction.user.displayName}'s memory`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
            .setColor(randomHexColor())
            .addFields({
                name: `Facts (${facts.length})`,
                value: factLines(facts).slice(0, MAX_FACTS_IN_PROMPT || 15).join("\n").slice(0, 1024) || "_(none)_",
            })
            .setFooter({ text: `${data?.messageCount || 0} message${(data?.messageCount || 0) === 1 ? "" : "s"} processed${flags.length ? " · " + flags.join(" · ") : ""}` });
        if (lastSummary) {
            embed.addFields({
                name: `Latest summary ${fmtTimestamp(lastSummary.timestamp)}`,
                value: (lastSummary.context || "").slice(0, 1024) || "_(empty)_",
            });
        }
        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
