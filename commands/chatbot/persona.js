const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const personas = require("../../utils/personas");
const { getThreadContext, updateThreadContext, addNewThreadContext } = require("../../utils/openai");
const { OWNER_ID } = require("../../config.js");
const logger = require("../../utils/logger");
const { buildErrorEmbed, buildSuccessEmbed, buildInfoEmbed } = require("../../utils/embeds");

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MAX_PROMPT_LEN = 2000;

function canModify(interaction, persona) {
  if (!persona) return false;
  if (interaction.user.id === persona.creatorId) return true;
  if (interaction.user.id === OWNER_ID) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  return false;
}

async function ensureContext(channel) {
  const ctx = await getThreadContext(channel);
  if (!ctx) {
    await addNewThreadContext(channel);
    return getThreadContext(channel);
  }
  return ctx;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("persona")
    .setDescription("Manage persistent chatbot personas for this server.")
    .addSubcommand(sub =>
      sub.setName("create")
        .setDescription("Create a new persona.")
        .addStringOption(o => o.setName("name").setDescription("Lowercase, a-z 0-9 hyphen, up to 32 chars.").setRequired(true))
        .addStringOption(o => o.setName("prompt").setDescription(`The persona's system prompt (up to ${MAX_PROMPT_LEN} chars).`).setRequired(true))
        .addBooleanOption(o => o.setName("public").setDescription("Whether anyone can use it (default true).").setRequired(false)))
    .addSubcommand(sub =>
      sub.setName("edit")
        .setDescription("Edit a persona you own.")
        .addStringOption(o => o.setName("name").setDescription("The persona to edit.").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("prompt").setDescription("New system prompt.").setRequired(false))
        .addBooleanOption(o => o.setName("public").setDescription("Toggle public/private.").setRequired(false)))
    .addSubcommand(sub =>
      sub.setName("use")
        .setDescription("Pin a persona to this channel/thread.")
        .addStringOption(o => o.setName("name").setDescription("The persona to use.").setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub =>
      sub.setName("clear")
        .setDescription("Unpin the persona from this channel/thread."))
    .addSubcommand(sub =>
      sub.setName("list")
        .setDescription("List all personas in this server."))
    .addSubcommand(sub =>
      sub.setName("delete")
        .setDescription("Delete a persona you own.")
        .addStringOption(o => o.setName("name").setDescription("The persona to delete.").setRequired(true).setAutocomplete(true))),

  async autocomplete(interaction) {
    if (!interaction.guildId) return interaction.respond([]);
    const focused = (interaction.options.getFocused() || "").toLowerCase();
    const all = personas.listForGuild(interaction.guildId);
    const filtered = all
      .filter(p => p.name.toLowerCase().startsWith(focused))
      .slice(0, 25)
      .map(p => ({ name: p.isPublic ? p.name : `${p.name} (private)`, value: p.name }));
    await interaction.respond(filtered);
  },

  async execute(interaction) {
    if (!interaction.guildId) {
      return interaction.reply({ embeds: [buildErrorEmbed(interaction.user, interaction.client, "Personas are only available in servers.")], flags: MessageFlags.Ephemeral });
    }
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === "create") {
      const name = interaction.options.getString("name").trim().toLowerCase();
      const prompt = interaction.options.getString("prompt").trim();
      const isPublic = interaction.options.getBoolean("public");

      if (!NAME_RE.test(name)) {
        return interaction.reply({ embeds: [buildErrorEmbed(interaction.user, interaction.client, "Persona name must be lowercase a-z, 0-9, or hyphens; 1-32 chars; must start with a letter or digit.")], flags: MessageFlags.Ephemeral });
      }
      if (prompt.length === 0 || prompt.length > MAX_PROMPT_LEN) {
        return interaction.reply({ embeds: [buildErrorEmbed(interaction.user, interaction.client, `Prompt must be 1-${MAX_PROMPT_LEN} characters.`)], flags: MessageFlags.Ephemeral });
      }
      if (personas.getByName(guildId, name)) {
        return interaction.reply({ embeds: [buildErrorEmbed(interaction.user, interaction.client, `A persona named **${name}** already exists in this server.`)], flags: MessageFlags.Ephemeral });
      }
      const created = personas.create({
        guildId,
        name,
        systemPrompt: prompt,
        creatorId: interaction.user.id,
        isPublic: isPublic === null ? true : isPublic,
      });
      logger.log(`[Persona] ${interaction.user.tag} created "${created.name}" in guild ${guildId}`);
      return interaction.reply({ embeds: [buildSuccessEmbed(interaction.user, interaction.client, `Created persona **${created.name}**.${created.isPublic ? "" : " (private)"} Use \`/persona use ${created.name}\` to pin it.`)], flags: MessageFlags.Ephemeral });
    }

    if (sub === "edit") {
      const name = interaction.options.getString("name").trim().toLowerCase();
      const persona = personas.getByName(guildId, name);
      if (!persona) return interaction.reply({ embeds: [buildErrorEmbed(interaction.user, interaction.client, `No persona named **${name}**.`)], flags: MessageFlags.Ephemeral });
      if (!canModify(interaction, persona)) {
        return interaction.reply({ embeds: [buildErrorEmbed(interaction.user, interaction.client, "You can only edit personas you created.")], flags: MessageFlags.Ephemeral });
      }
      const newPrompt = interaction.options.getString("prompt");
      const newPublic = interaction.options.getBoolean("public");
      if (newPrompt === null && newPublic === null) {
        return interaction.reply({ embeds: [buildErrorEmbed(interaction.user, interaction.client, "Pass at least one of `prompt` or `public` to change.")], flags: MessageFlags.Ephemeral });
      }
      if (newPrompt !== null && (newPrompt.trim().length === 0 || newPrompt.length > MAX_PROMPT_LEN)) {
        return interaction.reply({ embeds: [buildErrorEmbed(interaction.user, interaction.client, `Prompt must be 1-${MAX_PROMPT_LEN} characters.`)], flags: MessageFlags.Ephemeral });
      }
      const updated = personas.update(persona.id, {
        systemPrompt: newPrompt !== null ? newPrompt.trim() : undefined,
        isPublic: newPublic !== null ? newPublic : undefined,
      });
      logger.log(`[Persona] ${interaction.user.tag} edited "${updated.name}"`);
      return interaction.reply({ embeds: [buildSuccessEmbed(interaction.user, interaction.client, `Updated persona **${updated.name}**.`)], flags: MessageFlags.Ephemeral });
    }

    if (sub === "use") {
      const name = interaction.options.getString("name").trim().toLowerCase();
      const persona = personas.getByName(guildId, name);
      if (!persona) return interaction.reply({ embeds: [buildErrorEmbed(interaction.user, interaction.client, `No persona named **${name}**.`)], flags: MessageFlags.Ephemeral });
      if (!persona.isPublic && persona.creatorId !== interaction.user.id && interaction.user.id !== OWNER_ID) {
        return interaction.reply({ embeds: [buildErrorEmbed(interaction.user, interaction.client, `Persona **${name}** is private.`)], flags: MessageFlags.Ephemeral });
      }
      await ensureContext(interaction.channel);
      await updateThreadContext(interaction.channel, { persona_id: persona.id });
      logger.log(`[Persona] ${interaction.user.tag} pinned "${persona.name}" to ${interaction.channel.id}`);
      return interaction.reply({ embeds: [buildSuccessEmbed(interaction.user, interaction.client, `Pinned persona **${persona.name}** to this channel. The chatbot will speak as them until \`/persona clear\`.`)], flags: MessageFlags.Ephemeral });
    }

    if (sub === "clear") {
      await ensureContext(interaction.channel);
      const ctx = await getThreadContext(interaction.channel);
      if (!ctx?.persona_id) {
        return interaction.reply({ embeds: [buildErrorEmbed(interaction.user, interaction.client, "No persona is pinned to this channel.")], flags: MessageFlags.Ephemeral });
      }
      await updateThreadContext(interaction.channel, { persona_id: null });
      logger.log(`[Persona] ${interaction.user.tag} cleared persona from ${interaction.channel.id}`);
      return interaction.reply({ embeds: [buildSuccessEmbed(interaction.user, interaction.client, "Persona cleared from this channel.")], flags: MessageFlags.Ephemeral });
    }

    if (sub === "list") {
      const all = personas.listForGuild(guildId);
      if (all.length === 0) {
        return interaction.reply({ embeds: [buildInfoEmbed(interaction.user, interaction.client, "No personas exist in this server yet. Create one with `/persona create`.")], flags: MessageFlags.Ephemeral });
      }
      const ctx = await getThreadContext(interaction.channel);
      const activeId = ctx?.persona_id ?? null;
      const lines = all.map(p => {
        const marker = p.id === activeId ? " ← pinned here" : "";
        const visibility = p.isPublic ? "" : " *(private)*";
        return `**${p.name}**${visibility} — by <@${p.creatorId}>${marker}`;
      });
      return interaction.reply({
        embeds: [buildInfoEmbed(interaction.user, interaction.client, lines.join("\n").slice(0, 4000))
          .setTitle(`Personas in ${interaction.guild.name}`)
          .setFooter({ text: `${all.length} persona${all.length === 1 ? "" : "s"}` })],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "delete") {
      const name = interaction.options.getString("name").trim().toLowerCase();
      const persona = personas.getByName(guildId, name);
      if (!persona) return interaction.reply({ embeds: [buildErrorEmbed(interaction.user, interaction.client, `No persona named **${name}**.`)], flags: MessageFlags.Ephemeral });
      if (!canModify(interaction, persona)) {
        return interaction.reply({ embeds: [buildErrorEmbed(interaction.user, interaction.client, "You can only delete personas you created.")], flags: MessageFlags.Ephemeral });
      }
      personas.deleteById(persona.id);
      logger.log(`[Persona] ${interaction.user.tag} deleted "${persona.name}"`);
      return interaction.reply({ embeds: [buildSuccessEmbed(interaction.user, interaction.client, `Deleted persona **${persona.name}**. Channels that had it pinned will fall back to defaults on the next chatbot turn.`)], flags: MessageFlags.Ephemeral });
    }
  },
};
