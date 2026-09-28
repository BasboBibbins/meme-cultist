const { PermissionFlagsBits } = require("discord.js");

// Discord caps a checkbox group at 10 options and a modal at 5 top-level components.
const MAX_PER_GROUP = 10;
const MAX_GROUPS = 5;
const MAX_ROLES = MAX_PER_GROUP * MAX_GROUPS;
const DEFAULT_GROUP_LABEL = "Roles";

const ELEVATED_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.MentionEveryone,
];

const ASSIGN_REASONS = {
  everyone: "`@everyone` can't be handed out.",
  managed: "That role is managed by Discord or another app, so nobody can assign it.",
  protected: "That role controls bot access, so it can never be self-assigned.",
  elevated: "That role carries moderator-level permissions, so it can't be self-assigned.",
  above_bot: "That role is at or above my highest role, so I can't assign it. Move my role above it in Server Settings first.",
  above_invoker: "That role is at or above your highest role, so you can't make it self-assignable.",
};

const CAPACITY_REASONS = {
  full: `The list is full at ${MAX_ROLES} roles. Remove one first.`,
  category_full: `That category already has ${MAX_PER_GROUP} roles, the most one group can hold.`,
  too_many_groups: `The form can show at most ${MAX_GROUPS} groups. Put this role in an existing category.`,
};

function hasElevatedPermission(permissions) {
  const bits = BigInt(permissions ?? 0);
  return ELEVATED_PERMISSIONS.some(flag => (bits & flag) === flag);
}

// invokerTopPosition is null for the guild owner, who outranks every role.
function checkAssignable({ role, guildId, botTopPosition, invokerTopPosition = null, protectedRoleIds = [] }) {
  if (role.id === guildId) return "everyone";
  if (role.managed) return "managed";
  if (protectedRoleIds.includes(role.id)) return "protected";
  if (hasElevatedPermission(role.permissions)) return "elevated";
  if (role.position >= botTopPosition) return "above_bot";
  if (invokerTopPosition !== null && role.position >= invokerTopPosition) return "above_invoker";
  return null;
}

function groupForModal(entries) {
  const named = new Map();
  const loose = [];
  for (const entry of entries) {
    const label = entry.category?.trim();
    if (!label) {
      loose.push(entry);
      continue;
    }
    const key = label.toLowerCase();
    if (!named.has(key)) named.set(key, { label, entries: [] });
    named.get(key).entries.push(entry);
  }

  const groups = [...named.values()];
  const chunks = Math.ceil(loose.length / MAX_PER_GROUP);
  for (let i = 0; i < chunks; i++) {
    groups.push({
      label: chunks > 1 ? `${DEFAULT_GROUP_LABEL} (${i + 1})` : DEFAULT_GROUP_LABEL,
      entries: loose.slice(i * MAX_PER_GROUP, (i + 1) * MAX_PER_GROUP),
    });
  }
  return groups;
}

function checkCapacity(entries, candidate) {
  const exists = entries.some(e => e.roleId === candidate.roleId);
  const proposed = exists
    ? entries.map(e => (e.roleId === candidate.roleId ? { ...e, ...candidate } : e))
    : [...entries, candidate];

  if (proposed.length > MAX_ROLES) return "full";
  const groups = groupForModal(proposed);
  if (groups.some(g => g.entries.length > MAX_PER_GROUP)) return "category_full";
  if (groups.length > MAX_GROUPS) return "too_many_groups";
  return null;
}

// Returns { finalIds, added, removed } for a member whose current roles are currentIds.
function reconcileRoles(currentIds, submittedIds, listedIds) {
  const current = new Set(currentIds);
  const listed = new Set(listedIds);
  const wanted = new Set(submittedIds.filter(id => listed.has(id)));

  const added = [...wanted].filter(id => !current.has(id));
  const removed = currentIds.filter(id => listed.has(id) && !wanted.has(id));
  const finalIds = [
    ...currentIds.filter(id => !listed.has(id)),
    ...wanted
  ];


  return { finalIds, added, removed };
}

module.exports = {
  MAX_PER_GROUP,
  MAX_GROUPS,
  MAX_ROLES,
  ELEVATED_PERMISSIONS,
  ASSIGN_REASONS,
  CAPACITY_REASONS,
  hasElevatedPermission,
  checkAssignable,
  groupForModal,
  checkCapacity,
  reconcileRoles,
};
