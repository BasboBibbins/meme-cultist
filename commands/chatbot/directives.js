const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const { getThreadContext, updateThreadContext } = require("../../utils/openai");
const { mergeDirectives, removeDirective } = require("../../utils/directives");
const { buildErrorEmbed, buildSuccessEmbed, buildInfoEmbed } = require("../../utils/embeds");
const { withLock } = require("../../utils/lock");
const logger = require("../../utils/logger");
const { MAX_DIRECTIVES } = require("../../config.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("directives")
    .setDescription("Manage the standing instructions the chatbot follows in this channel.")
    .addSubcommand(sub =>
      sub.setName("add")
        .setDescription("Add a rule the chatbot must always follow here.")
        .addStringOption(o =>
          o.setName("instruction")
            .setDescription("e.g. Never reveal Wordle answers; give hints only when asked.")
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName("list")
        .setDescription("Show the standing instructions for this channel."))
    .addSubcommand(sub =>
      sub.setName("remove")
        .setDescription("Remove a standing instruction.")
        .addStringOption(o =>
          o.setName("directive")
            .setDescription("The instruction to remove.")
            .setRequired(true)
            .setAutocomplete(true))),

  async autocomplete(interaction) {
    const focused = (interaction.options.getFocused() || "").toLowerCase();
    const ctx = await getThreadContext(interaction.channel);
    const directives = Array.isArray(ctx?.directives) ? ctx.directives : [];
    const filtered = directives
      .filter(d => d.text.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(d => ({ name: d.text.slice(0, 100), value: d.id }));
    await interaction.respond(filtered);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "list") {
      const ctx = await getThreadContext(interaction.channel);
      const existing = Array.isArray(ctx?.directives) ? ctx.directives : [];
      const embed = buildInfoEmbed(interaction.user, interaction.client, existing.length === 0
        ? "No standing instructions are set for this channel."
        : existing.map(d => `• \`${d.id}\` ${d.text}`).join("\n"))
        .setTitle(`Standing instructions — #${interaction.channel.name}`)
        .setFooter({ text: `${existing.length}/${MAX_DIRECTIVES || 10} stored` });
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // Standing instructions bind the bot for everyone in the channel, so
    // changing them is gated the same way channel-level facts are.
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({
        embeds: [buildErrorEmbed(interaction.user, interaction.client, "You need Manage Channels to change standing instructions. You can still ask the bot directly in chat.")],
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      if (sub === "add") {
        const instruction = interaction.options.getString("instruction").trim();
        // Read inside the lock — a concurrent auto-extraction or second
        // invocation would otherwise be merged onto a stale snapshot and lost.
        const result = await withLock(`directives:${interaction.channel.id}`, async () => {
          const ctx = await getThreadContext(interaction.channel);
          const existing = Array.isArray(ctx?.directives) ? ctx.directives : [];
          const merged = mergeDirectives(existing, [instruction], {
            createdBy: interaction.user.id,
            source: "command",
          });
          if (merged.added.length === 0 && merged.reinforced.length === 0) return null;
          await updateThreadContext(interaction.channel, { directives: merged.directives });
          return merged;
        });

        if (!result) {
          return interaction.reply({
            embeds: [buildErrorEmbed(interaction.user, interaction.client, "That instruction was too short to store.")],
            flags: MessageFlags.Ephemeral,
          });
        }

        logger.log(`[Directives] ${interaction.user.tag} added an instruction to ${interaction.channel.id}`);
        const wasNew = result.added.length > 0;
        const dropped = result.dropped.length > 0
          ? ` Oldest instruction dropped to stay under the ${MAX_DIRECTIVES || 10} limit.`
          : "";
        return interaction.reply({
          embeds: [buildSuccessEmbed(interaction.user, interaction.client, wasNew
            ? `Standing instruction added.${dropped}`
            : "I already had that instruction — refreshed it.")],
          flags: MessageFlags.Ephemeral,
        });
      }

      const target = interaction.options.getString("directive").trim();
      const removed = await withLock(`directives:${interaction.channel.id}`, async () => {
        const ctx = await getThreadContext(interaction.channel);
        const existing = Array.isArray(ctx?.directives) ? ctx.directives : [];
        const res = removeDirective(existing, target);
        if (!res.removed) return null;
        await updateThreadContext(interaction.channel, { directives: res.directives });
        return res.removed;
      });

      if (!removed) {
        return interaction.reply({
          embeds: [buildErrorEmbed(interaction.user, interaction.client, "No matching standing instruction in this channel.")],
          flags: MessageFlags.Ephemeral,
        });
      }

      logger.log(`[Directives] ${interaction.user.tag} removed "${removed.text}" from ${interaction.channel.id}`);
      return interaction.reply({
        embeds: [buildSuccessEmbed(interaction.user, interaction.client, `Removed: ${removed.text}`)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      logger.error(`[Directives] ${sub} failed: ${err.message}`);
      return interaction.reply({
        embeds: [buildErrorEmbed(interaction.user, interaction.client, "Something went wrong updating the standing instructions.")],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
