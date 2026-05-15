const { SlashCommandBuilder, EmbedBuilder, Role } = require("discord.js");
const jobs = require("../../utils/jobs");
const { parseWhen } = require("../../utils/reminders/parse");
const { REMINDER_MAX_ACTIVE_PER_USER, REMINDER_MAX_GROUP_SIZE } = require("../../config.js");
const logger = require("../../utils/logger");

function countUserReminders(userId) {
    return jobs.list("reminder", row => {
        try {
            return JSON.parse(row.payload).userId === userId;
        } catch (_) {
            return false;
        }
    }).length;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("remind")
        .setDescription("Set, list, or cancel reminders.")
        .addSubcommand(subcommand =>
            subcommand
                .setName("add")
                .setDescription("Set a new reminder.")
                .addStringOption(option =>
                    option.setName("when")
                        .setDescription("When to remind you, e.g. 'in 2 hours', 'tomorrow at 3pm'")
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName("message")
                        .setDescription("What to remind you about")
                        .setRequired(true))
                .addMentionableOption(option =>
                    option.setName("target")
                        .setDescription("Optional user or role to also notify")
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName("frequency")
                        .setDescription("How often to repeat")
                        .addChoices(
                            { name: "Once", value: "once" },
                            { name: "Daily", value: "daily" },
                            { name: "Weekly", value: "weekly" }
                        )
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName("end_date")
                        .setDescription("When to stop repeating, e.g. 'in 2 weeks' (only if frequency is set)")
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName("list")
                .setDescription("Show your pending reminders."))
        .addSubcommand(subcommand =>
            subcommand
                .setName("cancel")
                .setDescription("Cancel a reminder by its ID.")
                .addIntegerOption(option =>
                    option.setName("id")
                        .setDescription("The reminder ID from /remind list")
                        .setRequired(true))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        await interaction.deferReply({ ephemeral: true });

        if (subcommand === "add") {
            const when = interaction.options.getString("when");
            const message = interaction.options.getString("message");
            const mentionable = interaction.options.getMentionable("target");
            const frequency = interaction.options.getString("frequency") || "once";
            const endDateRaw = interaction.options.getString("end_date");

            const parsed = parseWhen(when);
            if (!parsed.ok) {
                const embed = new EmbedBuilder()
                    .setTitle("❌ Invalid Time")
                    .setDescription(parsed.reason)
                    .setColor("#FF0000")
                    .setTimestamp();
                await interaction.editReply({ embeds: [embed] });
                return;
            }

            const activeCount = countUserReminders(userId);
            if (activeCount >= REMINDER_MAX_ACTIVE_PER_USER) {
                const embed = new EmbedBuilder()
                    .setTitle("❌ Too Many Reminders")
                    .setDescription(`You already have ${activeCount} active reminders. Cancel one with \`/remind cancel\` before adding another.`)
                    .setColor("#FF0000")
                    .setTimestamp();
                await interaction.editReply({ embeds: [embed] });
                return;
            }

            const targets = [userId];
            if (mentionable) {
                if (mentionable instanceof Role) {
                    targets.push(`role:${mentionable.id}`);
                } else {
                    targets.push(mentionable.id);
                }
            }

            const targetCount = mentionable && mentionable instanceof Role
                ? Math.min(mentionable.members.size, REMINDER_MAX_GROUP_SIZE)
                : targets.length;

            let recurrence = null;
            if (frequency === "daily" || frequency === "weekly") {
                const intervalMs = frequency === "daily" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
                let endAt = null;
                let maxOccurrences = null;
                if (endDateRaw) {
                    const endParsed = parseWhen(endDateRaw);
                    if (endParsed.ok) {
                        endAt = endParsed.runAt;
                    } else {
                        const embed = new EmbedBuilder()
                            .setTitle("❌ Invalid End Date")
                            .setDescription(endParsed.reason)
                            .setColor("#FF0000")
                            .setTimestamp();
                        await interaction.editReply({ embeds: [embed] });
                        return;
                    }
                }
                recurrence = { frequency, intervalMs, endAt, maxOccurrences, firedCount: 0 };
            }

            const jobId = jobs.enqueue({
                kind: "reminder",
                payload: {
                    userId,
                    channelId: interaction.channelId,
                    text: message,
                    targets,
                    createdBy: "slash",
                    recurrence,
                },
                run_at: parsed.runAt,
            });

            let description = `I'll remind you <t:${Math.floor(parsed.runAt / 1000)}:R>.\n\n**${message}**`;
            if (mentionable) {
                const targetName = mentionable.role ? `@${mentionable.name}` : `@${mentionable.displayName || mentionable.user?.username}`;
                description += `\n\n👥 Also notifying: ${targetName}`;
            }
            if (recurrence) {
                const freqLabel = recurrence.frequency === "daily" ? "Daily" : "Weekly";
                let recurText = `\n🔁 Repeats **${freqLabel}**`;
                if (recurrence.endAt) {
                    recurText += ` until <t:${Math.floor(recurrence.endAt / 1000)}:R>`;
                }
                description += recurText;
            }

            const embed = new EmbedBuilder()
                .setTitle("✅ Reminder Set")
                .setDescription(description)
                .setColor("#44FF44")
                .setFooter({ text: `Reminder ID: ${jobId} | Targets: ${targetCount}` })
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
            logger.log(`[Remind] User ${interaction.user.tag} set reminder ${jobId} for ${new Date(parsed.runAt).toISOString()}`);
            return;
        }

        if (subcommand === "list") {
            const rows = jobs.list("reminder", row => {
                try {
                    return JSON.parse(row.payload).userId === userId;
                } catch (_) {
                    return false;
                }
            });

            if (rows.length === 0) {
                const embed = new EmbedBuilder()
                    .setTitle("📋 Reminders")
                    .setDescription("You have no pending reminders.")
                    .setColor("#888888")
                    .setTimestamp();
                await interaction.editReply({ embeds: [embed] });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle("📋 Your Reminders")
                .setColor("#FFD700")
                .setTimestamp();

            const fields = rows.map(row => {
                const payload = JSON.parse(row.payload);
                const preview = payload.text.length > 40 ? payload.text.slice(0, 40) + "..." : payload.text;
                let label = `ID ${row.id} — <t:${Math.floor(row.run_at / 1000)}:R>`;
                if (payload.recurrence) {
                    const freq = payload.recurrence.frequency === "daily" ? "Daily" : "Weekly";
                    label += ` (${freq})`;
                }
                let extra = "";
                if (payload.targets && payload.targets.length > 1) {
                    extra += ` [${payload.targets.length} targets]`;
                }
                return {
                    name: label + extra,
                    value: preview,
                    inline: false,
                };
            });

            embed.addFields(fields);
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        if (subcommand === "cancel") {
            const id = interaction.options.getInteger("id");

            const rows = jobs.list("reminder", row => {
                try {
                    return JSON.parse(row.payload).userId === userId;
                } catch (_) {
                    return false;
                }
            });
            const owns = rows.some(row => row.id === id);

            if (!owns) {
                const embed = new EmbedBuilder()
                    .setTitle("❌ Not Found")
                    .setDescription("You don't have a pending reminder with that ID. Use \`/remind list\` to see your reminders.")
                    .setColor("#FF0000")
                    .setTimestamp();
                await interaction.editReply({ embeds: [embed] });
                return;
            }

            const ok = jobs.cancel(id);
            const embed = new EmbedBuilder()
                .setTitle(ok ? "✅ Cancelled" : "❌ Error")
                .setDescription(ok ? "That reminder has been cancelled." : "Could not cancel the reminder. It may have already fired.")
                .setColor(ok ? "#44FF44" : "#FF0000")
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
            logger.log(`[Remind] User ${interaction.user.tag} cancelled reminder ${id}`);
            return;
        }
    }
};
