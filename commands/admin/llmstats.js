const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const { OWNER_ID, ADMIN_COMMANDS_OWNER_ONLY } = require("../../config.js");
const logger = require("../../utils/logger");
const llm = require("../../utils/llm");
const jobs = require("../../utils/jobs");
const { buildErrorEmbed, buildInfoEmbed, buildSuccessEmbed } = require("../../utils/embeds");

function formatRow(variant, entry) {
  const total = entry.hit + entry.miss;
  const ratio = total > 0 ? (entry.hit / total) * 100 : 0;
  return [
    `**${variant}** — ${entry.calls.toLocaleString("en-US")} calls`,
    `hit \`${entry.hit.toLocaleString("en-US")}\` / miss \`${entry.miss.toLocaleString("en-US")}\` → **${ratio.toFixed(1)}%** hit`,
    `cost \`$${entry.cost.toFixed(4)}\``,
  ].join("\n");
}

function formatHealthRow(snap) {
  const lastOk = snap.lastOkAt ? `<t:${Math.floor(snap.lastOkAt / 1000)}:R>` : "never";
  const lines = [
    `${snap.degraded ? "⚠️" : "✅"} **${snap.provider}** — ${snap.calls} sample${snap.calls === 1 ? "" : "s"}`,
    `success \`${(snap.successRate * 100).toFixed(0)}%\` · p50 \`${snap.p50}ms\` · p95 \`${snap.p95}ms\``,
    `last success ${lastOk}`,
  ];
  if (snap.lastError) {
    lines.push(`last error \`${snap.lastError.code}\` <t:${Math.floor(snap.lastError.at / 1000)}:R>`);
  }
  return lines.join("\n");
}

const BREAKER_ICONS = { closed: "✅", half_open: "🟡", open: "⛔" };

function formatBreakerRow(snap, deferredCount) {
  if (!snap.enabled) return "**embed breaker** — disabled";
  const lines = [
    `${BREAKER_ICONS[snap.state] || "❔"} **embed breaker** — \`${snap.state}\``,
    `trips this session \`${snap.trips}\` · deferred jobs \`${deferredCount}\``,
  ];
  if (snap.openedAt) lines.push(`opened <t:${Math.floor(snap.openedAt / 1000)}:R>`);
  return lines.join("\n");
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("llmstats")
    .setDescription("[ADMIN] Inspect LLM prompt-cache hit rates and cost.")
    .addSubcommand(subcommand =>
      subcommand
        .setName("show")
        .setDescription("[ADMIN] Show per-variant cache hit/miss and cost since last reset."))
    .addSubcommand(subcommand =>
      subcommand
        .setName("reset")
        .setDescription("[ADMIN] Zero the collected cache statistics."))
    .addSubcommand(subcommand =>
      subcommand
        .setName("health")
        .setDescription("[ADMIN] Show per-provider success rate, latency, and degraded state.")),

  async execute(interaction) {
    const isOwner = interaction.user.id === OWNER_ID;
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    const allowed = isOwner || (!ADMIN_COMMANDS_OWNER_ONLY && isAdmin);
    if (!allowed) {
      return await interaction.reply({
        embeds: [buildErrorEmbed(interaction.user, interaction.client, "You do not have permission to use this command.")],
        flags: MessageFlags.Ephemeral,
      });
    }

    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "reset") {
        llm.resetCacheStats();
        logger.log(`LLM cache stats reset by ${interaction.user.username} (${interaction.user.id}).`, "info");
        return await interaction.reply({
          embeds: [buildSuccessEmbed(interaction.user, interaction.client, "LLM cache statistics reset.")],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (subcommand === "health") {
        const snapshots = Object.values(llm.getHealth());
        const active = snapshots.filter(s => s.calls > 0);
        if (active.length === 0) {
          return await interaction.reply({
            embeds: [buildInfoEmbed(interaction.user, interaction.client, "No provider calls recorded yet.")],
            flags: MessageFlags.Ephemeral,
          });
        }
        const sections = active.map(formatHealthRow);
        sections.push(formatBreakerRow(llm.getBreakerState(), jobs.countDeferred()));
        return await interaction.reply({
          embeds: [buildInfoEmbed(interaction.user, interaction.client, sections.join("\n\n"))
            .setTitle("Provider Health")],
          flags: MessageFlags.Ephemeral,
        });
      }

      const stats = llm.getCacheStats();
      const variants = Object.entries(stats).sort((a, b) => b[1].calls - a[1].calls);
      if (variants.length === 0) {
        return await interaction.reply({
          embeds: [buildInfoEmbed(interaction.user, interaction.client, "No LLM calls recorded yet.")],
          flags: MessageFlags.Ephemeral,
        });
      }

      let calls = 0, hit = 0, miss = 0, cost = 0;
      for (const [, e] of variants) {
        calls += e.calls;
        hit += e.hit;
        miss += e.miss;
        cost += e.cost;
      }
      const totalPrompt = hit + miss;
      const overallRatio = totalPrompt > 0 ? (hit / totalPrompt) * 100 : 0;
      const perCall = calls > 0 ? cost / calls : 0;

      const description = [
        `**Overall** — ${calls.toLocaleString("en-US")} calls, **${overallRatio.toFixed(1)}%** cache hit`,
        `prompt tokens \`${totalPrompt.toLocaleString("en-US")}\` · cost \`$${cost.toFixed(4)}\` · \`$${perCall.toFixed(5)}\`/call`,
        `projected at 1k calls/day: \`$${(perCall * 1000).toFixed(2)}\`/day`,
        "",
        ...variants.map(([variant, entry]) => formatRow(variant, entry)),
      ].join("\n");

      return await interaction.reply({
        embeds: [buildInfoEmbed(interaction.user, interaction.client, description)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      logger.error(`llmstats failed: ${err}`);
      return await interaction.reply({
        embeds: [buildErrorEmbed(interaction.user, interaction.client, "Could not read LLM statistics.")],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
