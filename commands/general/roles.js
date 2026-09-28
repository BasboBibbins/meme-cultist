const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { ROLES_MODAL_TIMEOUT_MS } = require("../../config.js");
const logger = require("../../utils/logger");
const { buildErrorEmbed, buildSuccessEmbed, buildInfoEmbed } = require("../../utils/embeds");
const { withLock } = require("../../utils/lock");
const { groupForModal, reconcileRoles, buildRolesModal, readSubmittedRoleIds } = require("../../utils/selfRoles");
const { resolveListedRoles } = require("../../utils/selfRoles/guild");

const MISSING_PERMISSIONS = 50013;

function mentionList(ids) {
  return ids.map(id => `<@&${id}>`).join(", ");
}

function heldRoleIds(member) {
  return new Set(Array.isArray(member.roles) ? member.roles : member.roles.cache.keys());
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("roles")
    .setDescription("Pick the roles you want, like game roles so people can ping you."),

  async execute(interaction) {
    const { user, client } = interaction;
    if (!interaction.inGuild()) {
      return interaction.reply({
        embeds: [buildErrorEmbed(user, client, "Roles only exist inside a server. Run this there.")],
        flags: MessageFlags.Ephemeral,
      });
    }
    const guild = interaction.guild;

    let listed;
    try {
      ({ usable: listed } = await resolveListedRoles(guild));
    } catch (err) {
      logger.error(`[SelfRoles] Could not load roles for guild ${guild.id}: ${err.message}`);
      return interaction.reply({
        embeds: [buildErrorEmbed(user, client, "Couldn't load the role list. Try again in a moment.")],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (listed.length === 0) {
      return interaction.reply({
        embeds: [buildErrorEmbed(user, client, "No roles are set up for self-assign here yet. An admin can add some with `/roleconfig add`.")],
        flags: MessageFlags.Ephemeral,
      });
    }

    const groups = groupForModal(listed);
    const roleNames = new Map(listed.map(e => [e.roleId, guild.roles.cache.get(e.roleId).name]));
    const shownIds = new Set(listed.map(e => e.roleId));

    // showModal must be the initial response, so nothing may defer before this.
    const modalId = `roles:${interaction.id}`;
    await interaction.showModal(buildRolesModal(modalId, groups, roleNames, heldRoleIds(interaction.member)));

    let submit;
    try {
      submit = await interaction.awaitModalSubmit({
        filter: m => m.customId === modalId && m.user.id === user.id,
        time: ROLES_MODAL_TIMEOUT_MS,
      });
    } catch {
      return;
    }

    await submit.deferReply({ flags: MessageFlags.Ephemeral });
    const submitted = readSubmittedRoleIds(submit, groups.length);

    try {
      const outcome = await withLock(`selfroles:${guild.id}:${user.id}`, async () => {
        const { usable } = await resolveListedRoles(guild);
        // A role listed after the form opened was never shown, so leaving it unchecked must not remove it.
        const managedIds = usable.map(e => e.roleId).filter(id => shownIds.has(id));
        const member = await guild.members.fetch({ user: user.id, force: true });
        const currentIds = [...member.roles.cache.keys()].filter(id => id !== guild.id);
        const result = reconcileRoles(currentIds, submitted, managedIds);
        if (result.added.length > 0 || result.removed.length > 0) {
          await member.roles.set(result.finalIds, "Self-serve /roles");
        }
        return result;
      });

      if (outcome.added.length === 0 && outcome.removed.length === 0) {
        return submit.editReply({ embeds: [buildInfoEmbed(user, client, "No changes. Your roles already match what you picked.")] });
      }

      const lines = [];
      if (outcome.added.length > 0) lines.push(`**Added:** ${mentionList(outcome.added)}`);
      if (outcome.removed.length > 0) lines.push(`**Removed:** ${mentionList(outcome.removed)}`);
      logger.log(`[SelfRoles] ${user.username} (${user.id}) in ${guild.id}: +${outcome.added.length} -${outcome.removed.length}`);
      return submit.editReply({ embeds: [buildSuccessEmbed(user, client, lines.join("\n"))] });
    } catch (err) {
      logger.error(`[SelfRoles] /roles failed for ${user.id} in ${guild.id}: ${err.message}`);
      const text = err.code === MISSING_PERMISSIONS
        ? "I don't have permission to change those roles. An admin needs to move my role above them. Nothing was changed."
        : "Something went wrong updating your roles. Nothing was changed.";
      return submit.editReply({ embeds: [buildErrorEmbed(user, client, text)] });
    }
  },
};
