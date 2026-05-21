const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { getUserChatbotData, updateUserChatbotData, getThreadContext, updateThreadContext } = require("../../utils/openai");
const logger = require("../../utils/logger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("forget")
    .setDescription("Tell the chatbot to forget a specific fact it has stored.")
    .addStringOption(o =>
      o.setName("fact_key")
        .setDescription("The fact key to remove.")
        .setRequired(true)
        .setAutocomplete(true))
    .addStringOption(o =>
      o.setName("scope")
        .setDescription("Forget a fact about yourself (default) or a channel-level fact.")
        .addChoices(
          { name: "me", value: "me" },
          { name: "channel", value: "channel" },
        )
        .setRequired(false)),

  async autocomplete(interaction) {
    const scope = interaction.options.getString("scope") || "me";
    const focused = (interaction.options.getFocused() || "").toLowerCase();
    let facts = [];
    if (scope === "channel") {
      const ctx = await getThreadContext(interaction.channel);
      facts = ctx?.facts || [];
    } else {
      const data = await getUserChatbotData(interaction.user.id);
      facts = data?.facts || [];
    }
    const filtered = facts
      .filter(f => f.key.toLowerCase().startsWith(focused))
      .slice(0, 25)
      .map(f => ({ name: `${f.key} = ${String(f.value).slice(0, 80)}`, value: f.key }));
    await interaction.respond(filtered);
  },

  async execute(interaction) {
    const factKey = interaction.options.getString("fact_key").trim();
    const scope = interaction.options.getString("scope") || "me";

    if (scope === "channel") {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({ content: "You need Manage Channels to remove channel-level facts.", ephemeral: true });
      }
      const ctx = await getThreadContext(interaction.channel);
      const facts = Array.isArray(ctx?.facts) ? ctx.facts : [];
      const before = facts.length;
      const next = facts.filter(f => f.key !== factKey);
      if (next.length === before) {
        return interaction.reply({ content: `No channel fact with key **${factKey}**.`, ephemeral: true });
      }
      await updateThreadContext(interaction.channel, { facts: next });
      logger.log(`[Forget] ${interaction.user.tag} removed channel fact "${factKey}" from ${interaction.channel.id}`);
      return interaction.reply({ content: `Forgot channel fact **${factKey}**.`, ephemeral: true });
    }

    const data = await getUserChatbotData(interaction.user.id);
    const facts = Array.isArray(data?.facts) ? data.facts : [];
    const before = facts.length;
    const next = facts.filter(f => f.key !== factKey);
    if (next.length === before) {
      return interaction.reply({ content: `I don't have a fact with key **${factKey}** about you.`, ephemeral: true });
    }
    await updateUserChatbotData(interaction.user.id, { facts: next });
    logger.log(`[Forget] ${interaction.user.tag} removed user fact "${factKey}"`);
    await interaction.reply({ content: `Forgot **${factKey}**.`, ephemeral: true });
  },
};
