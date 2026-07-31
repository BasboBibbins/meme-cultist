const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { OWNER_ID, ADMIN_COMMANDS_OWNER_ONLY } = require("../../config.js");
const logger = require("../../utils/logger");
const llm = require("../../utils/llm");
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
        .setDescription("[ADMIN] Zero the collected cache statistics.")),

  async execute(interaction) {
    const isOwner = interaction.user.id === OWNER_ID;
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    const allowed = isOwner || (!ADMIN_COMMANDS_OWNER_ONLY && isAdmin);
    if (!allowed) {
      return await interaction.reply({
        embeds: [buildErrorEmbed(interaction.user, interaction.client, "You do not have permission to use this command.")],
        ephemeral: true,
      });
    }

    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "reset") {
        llm.resetCacheStats();
        logger.log(`LLM cache stats reset by ${interaction.user.username} (${interaction.user.id}).`, "info");
        return await interaction.reply({
          embeds: [buildSuccessEmbed(interaction.user, interaction.client, "LLM cache statistics reset.")],
          ephemeral: true,
        });
      }

      const stats = llm.getCacheStats();
      const variants = Object.entries(stats).sort((a, b) => b[1].calls - a[1].calls);
      if (variants.length === 0) {
        return await interaction.reply({
          embeds: [buildInfoEmbed(interaction.user, interaction.client, "No LLM calls recorded yet.")],
          ephemeral: true,
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
        ephemeral: true,
      });
    } catch (err) {
      logger.error(`llmstats failed: ${err}`);
      return await interaction.reply({
        embeds: [buildErrorEmbed(interaction.user, interaction.client, "Could not read LLM statistics.")],
        ephemeral: true,
      });
    }
  },
};
