const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const { OWNER_ID, ADMIN_COMMANDS_OWNER_ONLY } = require("../../config.js");
const logger = require("../../utils/logger");
const { buildErrorEmbed, buildSuccessEmbed, buildInfoEmbed } = require("../../utils/embeds");
const { store, groupForModal, checkCapacity, ASSIGN_REASONS, CAPACITY_REASONS, MAX_ROLES, LABEL_LIMIT, OPTION_TEXT_LIMIT } = require("../../utils/selfRoles");
const { getBotMember, checkGuildRole, resolveListedRoles } = require("../../utils/selfRoles/guild");

function reply(interaction, embed) {
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleAdd(interaction) {
  const { guild, user, client } = interaction;
  const role = guild.roles.cache.get(interaction.options.getRole("role", true).id);
  if (!role) return reply(interaction, buildErrorEmbed(user, client, "I can't find that role."));

  const reason = checkGuildRole(guild, role, await getBotMember(guild), interaction.member);
  if (reason) return reply(interaction, buildErrorEmbed(user, client, ASSIGN_REASONS[reason]));

  const category = interaction.options.getString("category")?.trim() || null;
  const description = interaction.options.getString("description")?.trim() || null;

  // No await from here to the write: the capacity check and the insert must see the same list.
  const entries = store.listForGuild(guild.id);
  const capacity = checkCapacity(entries, { roleId: role.id, category, description });
  if (capacity) return reply(interaction, buildErrorEmbed(user, client, CAPACITY_REASONS[capacity]));

  const existed = entries.some(e => e.roleId === role.id);
  store.upsert({ guildId: guild.id, roleId: role.id, category, description, addedBy: user.id });

  logger.log(`[SelfRoles] ${user.username} (${user.id}) ${existed ? "updated" : "added"} role ${role.id} in ${guild.id}`);
  const where = category ? ` under **${category}**` : "";
  return reply(interaction, buildSuccessEmbed(user, client, existed
    ? `Updated ${role}${where}.`
    : `${role} can now be picked with \`/roles\`${where}.`));
}

async function handleRemove(interaction) {
  const { guild, user, client } = interaction;
  const role = interaction.options.getRole("role", true);
  if (!store.remove(guild.id, role.id)) {
    return reply(interaction, buildErrorEmbed(user, client, `<@&${role.id}> isn't on the \`/roles\` list.`));
  }
  logger.log(`[SelfRoles] ${user.username} (${user.id}) removed role ${role.id} in ${guild.id}`);
  return reply(interaction, buildSuccessEmbed(user, client, `<@&${role.id}> is off the \`/roles\` list. Members who already have it keep it.`));
}

async function handleList(interaction) {
  const { guild, user, client } = interaction;
  const { usable, blocked } = await resolveListedRoles(guild);
  if (usable.length === 0 && blocked.length === 0) {
    return reply(interaction, buildInfoEmbed(user, client, "No self-assignable roles yet. Add one with `/roleconfig add`."));
  }

  const sections = groupForModal(usable).map(g =>
    `**${g.label}**\n${g.entries.map(e => `<@&${e.roleId}>`).join(", ")}`);
  if (blocked.length > 0) {
    sections.push(`**Listed but not offered right now**\n${blocked.map(e => `<@&${e.roleId}>: ${ASSIGN_REASONS[e.reason]}`).join("\n")}`);
  }

  const embed = buildInfoEmbed(user, client, sections.join("\n\n"))
    .setTitle("Self-assignable roles")
    .setFooter({ text: `${usable.length + blocked.length}/${MAX_ROLES} roles` });
  return reply(interaction, embed);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("roleconfig")
    .setDescription("[ADMIN] Choose which roles members can give themselves with /roles.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(sub =>
      sub.setName("add")
        .setDescription("[ADMIN] Offer a role in /roles, or update its category and description.")
        .addRoleOption(o => o.setName("role").setDescription("The role to offer.").setRequired(true))
        .addStringOption(o =>
          o.setName("category")
            .setDescription("Group heading in the form, e.g. Games. Leave empty for the default group.")
            .setMaxLength(LABEL_LIMIT))
        .addStringOption(o =>
          o.setName("description")
            .setDescription("Short hint shown under the role in the form.")
            .setMaxLength(OPTION_TEXT_LIMIT)))
    .addSubcommand(sub =>
      sub.setName("remove")
        .setDescription("[ADMIN] Stop offering a role in /roles.")
        .addRoleOption(o => o.setName("role").setDescription("The role to stop offering.").setRequired(true)))
    .addSubcommand(sub =>
      sub.setName("list")
        .setDescription("[ADMIN] Show every role /roles offers.")),

  async execute(interaction) {
    const { user, client } = interaction;
    if (!interaction.inGuild()) {
      return reply(interaction, buildErrorEmbed(user, client, "This only works inside a server."));
    }

    // Default member permissions are a UI hint that server owners can override, so the check is repeated here.
    const isOwner = user.id === OWNER_ID;
    const canManageRoles = interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles) ?? false;
    if (!(isOwner || (!ADMIN_COMMANDS_OWNER_ONLY && canManageRoles))) {
      return reply(interaction, buildErrorEmbed(user, client, "You do not have permission to use this command."));
    }

    const sub = interaction.options.getSubcommand();
    try {
      if (sub === "add") return await handleAdd(interaction);
      if (sub === "remove") return await handleRemove(interaction);
      return await handleList(interaction);
    } catch (err) {
      logger.error(`[SelfRoles] /roleconfig ${sub} failed in ${interaction.guild.id}: ${err.message}`);
      return reply(interaction, buildErrorEmbed(user, client, "Something went wrong updating the role list."));
    }
  },
};
