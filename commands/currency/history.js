const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { CURRENCY_NAME, HISTORY_RESULT_LIMIT } = require("../../config.js");
const logger = require("../../utils/logger");
const { buildErrorEmbed, buildInfoEmbed } = require("../../utils/embeds");
const { PRUNE_DAYS, getRecentGameResults } = require("../../utils/gameResults");
const { formatHistoryLine, formatSigned, summarizeHistory, historySpan } = require("../../utils/gameHistory");
const { getEquippedTheme } = require("../../themes/manager");
const { getThemeColors } = require("../../themes/resolver");

const DEFAULT_ACCENT = 0x0f4c25;

function toInt(value, fallback) {
  if (Number.isInteger(value)) return value;
  const parsed = parseInt(String(value).replace(/^#/, ""), 16);
  return Number.isNaN(parsed) ? fallback : parsed;
}

async function resolveAccent(userId) {
  try {
    const colors = getThemeColors(await getEquippedTheme(userId), "history");
    return toInt(colors?.embedColor, DEFAULT_ACCENT);
  } catch (err) {
    logger.warn(`[History] Theme lookup failed for ${userId}: ${err.message}`);
    return DEFAULT_ACCENT;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("history")
    .setDescription(`Show your last ${HISTORY_RESULT_LIMIT} game results from anywhere in this server.`),
  async execute(interaction) {
    const user = interaction.user;
    if (!interaction.guildId) {
      return await interaction.reply({ embeds: [buildErrorEmbed(user, interaction.client, "Game history is only available in a server.")], flags: MessageFlags.Ephemeral });
    }
    try {
      const rows = getRecentGameResults({ guildId: interaction.guildId, userId: user.id, limit: HISTORY_RESULT_LIMIT });
      const accent = await resolveAccent(user.id);
      if (rows.length === 0) {
        const emptyEmbed = buildInfoEmbed(user, interaction.client, `Nothing here yet. Play a round of \`/slots\`, \`/blackjack\` or \`/keno\` and it will show up here. Results stick around for ${PRUNE_DAYS} days.`, accent)
          .setAuthor({ name: `${user.displayName}'s Game History`, iconURL: user.displayAvatarURL({ dynamic: true }) });
        return await interaction.reply({ embeds: [emptyEmbed] });
      }

      const totals = summarizeHistory(rows);
      const span = historySpan(rows);
      const lines = rows.map(formatHistoryLine).join("\n");
      const newestSec = span && Math.floor(span.newest / 1000);
      const oldestSec = span && Math.floor(span.oldest / 1000);
      const when = !span ? ""
        : newestSec === oldestSec ? `<t:${newestSec}:R>`
          : `<t:${newestSec}:R> back to <t:${oldestSec}:R>`;
      const spanNote = span
        ? `*Newest first, ${when}. Anywhere in this server; results older than ${PRUNE_DAYS} days are deleted.*`
        : `*Anywhere in this server; results older than ${PRUNE_DAYS} days are deleted.*`;
      const embed = buildInfoEmbed(user, interaction.client, `${lines}\n\n${spanNote}`, accent)
        .setAuthor({ name: `${user.displayName}'s Last ${rows.length} Results`, iconURL: user.displayAvatarURL({ dynamic: true }) })
        .addFields(
          { name: "Net", value: `**${formatSigned(totals.net)}** ${CURRENCY_NAME}`, inline: true },
          { name: "Wagered", value: `${totals.wagered.toLocaleString("en-US")} ${CURRENCY_NAME}`, inline: true },
          { name: "Record", value: totals.pushes > 0 ? `${totals.wins}W / ${totals.losses}L / ${totals.pushes}P` : `${totals.wins}W / ${totals.losses}L`, inline: true },
        );
      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      logger.error(`/history failed for ${user.id}: ${err}`);
      await interaction.reply({ embeds: [buildErrorEmbed(user, interaction.client, "Could not load your game history.")], flags: MessageFlags.Ephemeral });
    }
  },
};
