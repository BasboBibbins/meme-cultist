const { SlashCommandBuilder, Role, MessageFlags } = require("discord.js");
const jobs = require("../../utils/jobs");
const { parseWhen } = require("../../utils/reminders/parse");
const { REMINDER_MAX_ACTIVE_PER_USER, REMINDER_MAX_GROUP_SIZE } = require("../../config.js");
const logger = require("../../utils/logger");
const { buildErrorEmbed, buildSuccessEmbed, buildInfoEmbed, COLORS } = require("../../utils/embeds");

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

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (subcommand === "add") {
      const when = interaction.options.getString("when");
      const message = interaction.options.getString("message");
      const mentionable = interaction.options.getMentionable("target");
      const frequency = interaction.options.getString("frequency") || "once";
      const endDateRaw = interaction.options.getString("end_date");

      const parsed = parseWhen(when);
      if (!parsed.ok) {
        await interaction.editReply({ embeds: [buildErrorEmbed(interaction.user, interaction.client, parsed.reason).setTitle("❌ Invalid Time")] });
        return;
      }

      const activeCount = countUserReminders(userId);
      if (activeCount >= REMINDER_MAX_ACTIVE_PER_USER) {
        await interaction.editReply({ embeds: [buildErrorEmbed(interaction.user, interaction.client, `You already have ${activeCount} active reminders. Cancel one with \`/remind cancel\` before adding another.`).setTitle("❌ Too Many Reminders")] });
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
        const maxOccurrences = null;
        if (endDateRaw) {
          const endParsed = parseWhen(endDateRaw);
          if (endParsed.ok) {
            endAt = endParsed.runAt;
          } else {
            await interaction.editReply({ embeds: [buildErrorEmbed(interaction.user, interaction.client, endParsed.reason).setTitle("❌ Invalid End Date")] });
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
          recurText += ` until <t:${Math.floor(recurrence.endAt / 1000)}:F>`;
        }
        description += recurText;
      }

      const embed = buildSuccessEmbed(interaction.user, interaction.client, description)
        .setTitle("✅ Reminder Set")
        .setFooter({ text: `Reminder ID: ${jobId} | Targets: ${targetCount}` });
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
        await interaction.editReply({ embeds: [buildInfoEmbed(interaction.user, interaction.client, "You have no pending reminders.", COLORS.neutral).setTitle("📋 Reminders")] });
        return;
      }

      const embed = buildInfoEmbed(interaction.user, interaction.client, undefined, "#FFD700")
        .setTitle("📋 Your Reminders");

      const fields = rows.map(row => {
        const payload = JSON.parse(row.payload);
        const preview = payload.text.length > 40 ? payload.text.slice(0, 40) + "..." : payload.text;
        let label = `ID ${row.id} — <t:${Math.floor(row.run_at / 1000)}:S>`;
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

      const ok = jobs.cancel(id, (payload, row) => row.kind === "reminder" && payload.userId === userId);

      if (!ok) {
        await interaction.editReply({ embeds: [buildErrorEmbed(interaction.user, interaction.client, "You don't have a pending reminder with that ID. Use `/remind list` to see your reminders.").setTitle("❌ Not Found")] });
        return;
      }

      await interaction.editReply({ embeds: [buildSuccessEmbed(interaction.user, interaction.client, "That reminder has been cancelled.").setTitle("✅ Cancelled")] });
      logger.log(`[Remind] User ${interaction.user.tag} cancelled reminder ${id}`);
      return;
    }
  }
};
