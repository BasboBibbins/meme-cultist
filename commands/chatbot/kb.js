const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const kbStore = require("../../utils/kb");
const kbPreflight = require("../../utils/kb/preflight");
const llm = require("../../utils/llm");
const jobs = require("../../utils/jobs");
const { OWNER_ID, ADMIN_COMMANDS_OWNER_ONLY, KB_LEXICAL_FALLBACK_MIN_SCORE, EMBED_JOB_MAX_ATTEMPTS } = require("../../config.js");
const logger = require("../../utils/logger");
const { buildErrorEmbed, buildSuccessEmbed, buildInfoEmbed } = require("../../utils/embeds");

const SLUG_RE = /^[a-z0-9-]{1,64}$/;
const MAX_TITLE_LEN = 100;
const MAX_CONTENT_LEN = 4000;

function isAdmin(interaction) {
  const isOwner = interaction.user.id === OWNER_ID;
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
  return isOwner || (!ADMIN_COMMANDS_OWNER_ONLY && isAdmin);
}

function enqueueEmbed(guildId, slug) {
  kbPreflight.invalidate(guildId);
  try {
    jobs.enqueue({
      kind: "kb_embed",
      payload: { guildId, slug },
      run_at: Date.now(),
      max_attempts: EMBED_JOB_MAX_ATTEMPTS,
    });
  } catch (err) {
    logger.error(`[KB] Failed to enqueue embed job: ${err.message}`);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("kb")
    .setDescription("Manage the server's knowledge base.")
    .addSubcommand(sub =>
      sub.setName("add")
        .setDescription("Add a new knowledge base entry (admin only).")
        .addStringOption(o => o.setName("slug").setDescription("Short lowercase identifier (a-z, 0-9, hyphens).").setRequired(true))
        .addStringOption(o => o.setName("title").setDescription("Display title (max 100 chars).").setRequired(true))
        .addStringOption(o => o.setName("content").setDescription("Article body (max 4000 chars).").setRequired(true))
        .addStringOption(o => o.setName("tags").setDescription("Comma-separated tags (optional).").setRequired(false)))
    .addSubcommand(sub =>
      sub.setName("edit")
        .setDescription("Edit an existing entry (admin only).")
        .addStringOption(o => o.setName("slug").setDescription("The entry to edit.").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("title").setDescription("New title.").setRequired(false))
        .addStringOption(o => o.setName("content").setDescription("New content.").setRequired(false))
        .addStringOption(o => o.setName("tags").setDescription("New comma-separated tags.").setRequired(false)))
    .addSubcommand(sub =>
      sub.setName("delete")
        .setDescription("Delete an entry (admin only).")
        .addStringOption(o => o.setName("slug").setDescription("The entry to delete.").setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub =>
      sub.setName("list")
        .setDescription("List all knowledge base entries."))
    .addSubcommand(sub =>
      sub.setName("search")
        .setDescription("Search the knowledge base.")
        .addStringOption(o => o.setName("query").setDescription("What to search for.").setRequired(true))),

  async autocomplete(interaction) {
    if (!interaction.guildId) return interaction.respond([]);
    const focused = (interaction.options.getFocused() || "").toLowerCase();
    const all = kbStore.listForGuild(interaction.guildId);
    const filtered = all
      .filter(e => e.slug.toLowerCase().startsWith(focused))
      .slice(0, 25)
      .map(e => ({ name: `${e.slug} — ${e.title}`, value: e.slug }));
    await interaction.respond(filtered);
  },

  async execute(interaction) {
    if (!interaction.guildId) {
      return interaction.reply({ content: "Knowledge base is only available in servers.", flags: MessageFlags.Ephemeral });
    }
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === "add") {
      if (!isAdmin(interaction)) {
        return interaction.reply({ embeds: [buildErrorEmbed(interaction.user, interaction.client, "You do not have permission to manage the knowledge base.").setTitle("Permission Denied")], flags: MessageFlags.Ephemeral });
      }
      const slug = interaction.options.getString("slug").trim().toLowerCase();
      const title = interaction.options.getString("title").trim();
      const content = interaction.options.getString("content").trim();
      const tags = interaction.options.getString("tags")?.trim() || null;

      if (!SLUG_RE.test(slug)) {
        return interaction.reply({ content: "Slug must be 1-64 lowercase characters: a-z, 0-9, hyphens.", flags: MessageFlags.Ephemeral });
      }
      if (title.length === 0 || title.length > MAX_TITLE_LEN) {
        return interaction.reply({ content: `Title must be 1-${MAX_TITLE_LEN} characters.`, flags: MessageFlags.Ephemeral });
      }
      if (content.length === 0 || content.length > MAX_CONTENT_LEN) {
        return interaction.reply({ content: `Content must be 1-${MAX_CONTENT_LEN} characters.`, flags: MessageFlags.Ephemeral });
      }
      if (kbStore.getBySlug(guildId, slug)) {
        return interaction.reply({ content: `Entry **${slug}** already exists. Use \`\/kb edit\` to modify it.`, flags: MessageFlags.Ephemeral });
      }

      const entry = await kbStore.create({ guildId, slug, title, content, tags, creatorId: interaction.user.id });
      enqueueEmbed(guildId, slug);
      logger.log(`[KB] ${interaction.user.tag} created "${slug}" in guild ${guildId}`);

      return interaction.reply({
        embeds: [buildSuccessEmbed(interaction.user, interaction.client, `**${entry.title}** (${entry.slug})`).setTitle("Knowledge Base Entry Added")],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "edit") {
      if (!isAdmin(interaction)) {
        return interaction.reply({ embeds: [buildErrorEmbed(interaction.user, interaction.client, "You do not have permission to manage the knowledge base.").setTitle("Permission Denied")], flags: MessageFlags.Ephemeral });
      }
      const slug = interaction.options.getString("slug").trim().toLowerCase();
      const entry = kbStore.getBySlug(guildId, slug);
      if (!entry) return interaction.reply({ content: `No entry named **${slug}**.`, flags: MessageFlags.Ephemeral });

      const title = interaction.options.getString("title")?.trim();
      const content = interaction.options.getString("content")?.trim();
      const tags = interaction.options.getString("tags")?.trim();
      if (title === undefined && content === undefined && tags === undefined) {
        return interaction.reply({ content: "Pass at least one field to change.", flags: MessageFlags.Ephemeral });
      }
      if (title !== undefined && (title.length === 0 || title.length > MAX_TITLE_LEN)) {
        return interaction.reply({ content: `Title must be 1-${MAX_TITLE_LEN} characters.`, flags: MessageFlags.Ephemeral });
      }
      if (content !== undefined && (content.length === 0 || content.length > MAX_CONTENT_LEN)) {
        return interaction.reply({ content: `Content must be 1-${MAX_CONTENT_LEN} characters.`, flags: MessageFlags.Ephemeral });
      }

      await kbStore.update({ guildId, slug, title, content, tags });
      enqueueEmbed(guildId, slug);
      logger.log(`[KB] ${interaction.user.tag} edited "${slug}"`);

      return interaction.reply({
        embeds: [buildSuccessEmbed(interaction.user, interaction.client, `**${entry.title}** (${slug})`).setTitle("Knowledge Base Entry Updated")],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "delete") {
      if (!isAdmin(interaction)) {
        return interaction.reply({ embeds: [buildErrorEmbed(interaction.user, interaction.client, "You do not have permission to manage the knowledge base.").setTitle("Permission Denied")], flags: MessageFlags.Ephemeral });
      }
      const slug = interaction.options.getString("slug").trim().toLowerCase();
      const entry = kbStore.getBySlug(guildId, slug);
      if (!entry) return interaction.reply({ content: `No entry named **${slug}**.`, flags: MessageFlags.Ephemeral });

      kbStore.deleteBySlug(guildId, slug);
      kbPreflight.invalidate(guildId);
      logger.log(`[KB] ${interaction.user.tag} deleted "${slug}"`);
      return interaction.reply({ content: `Deleted **${slug}**.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === "list") {
      const all = kbStore.listForGuild(guildId);
      if (all.length === 0) {
        return interaction.reply({ content: "No knowledge base entries yet. Admins can add them with `\/kb add`.", flags: MessageFlags.Ephemeral });
      }
      const lines = all.map(e => `**${e.slug}** — ${e.title}`);
      return interaction.reply({
        embeds: [buildInfoEmbed(interaction.user, interaction.client, lines.join("\n").slice(0, 4000))
          .setTitle(`Knowledge Base — ${interaction.guild.name}`)
          .setFooter({ text: `${all.length} entr${all.length === 1 ? "y" : "ies"}` })],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "search") {
      const query = interaction.options.getString("query").trim();
      if (!query) return interaction.reply({ content: "Query cannot be empty.", flags: MessageFlags.Ephemeral });

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Semantic first, keyword second. The KB store has no lexical index of its
      // own, so without this an unavailable embedding endpoint turns every search
      // into "Search failed" even though the pre-flight scorer can answer it
      // locally from the same table.
      let results;
      let approximate = false;
      try {
        const { embedding } = await llm.embed({ text: query });
        results = kbStore.search(guildId, embedding, 5);
      } catch (err) {
        logger.warn(`[KB search] Semantic search failed, falling back to lexical: ${err.message}`);
        results = kbPreflight.findRelevant(guildId, query, 5, KB_LEXICAL_FALLBACK_MIN_SCORE);
        approximate = true;
      }

      try {
        if (results.length === 0) {
          return interaction.editReply({ content: "No matching knowledge base entries found." });
        }
        const lines = results.map((r, i) => {
          const snippet = r.content.length > 200 ? r.content.slice(0, 200) + "..." : r.content;
          return `${i + 1}. **${r.title}** (${r.slug})\n${snippet}`;
        });
        const footer = approximate
          ? `${results.length} result${results.length === 1 ? "" : "s"} — keyword match (approximate ranking)`
          : `${results.length} result${results.length === 1 ? "" : "s"}`;
        return interaction.editReply({
          embeds: [buildInfoEmbed(interaction.user, interaction.client, lines.join("\n\n").slice(0, 4000))
            .setTitle(`Search Results — "${query}"`)
            .setFooter({ text: footer })],
        });
      } catch (err) {
        logger.error(`[KB search] ${err.message}`);
        return interaction.editReply({ content: "Search failed. Please try again later." });
      }
    }
  },
};
