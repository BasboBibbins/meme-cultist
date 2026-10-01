const { BANNED_ROLE, TESTING_ROLE } = require("../../config.js");
const logger = require("../logger");
const store = require("./store");
const { checkAssignable } = require("./logic");

const PROTECTED_ROLE_IDS = [BANNED_ROLE, TESTING_ROLE];

async function getBotMember(guild) {
  return guild.members.me ?? guild.members.fetchMe();
}

// Pass invoker only when an admin is configuring; members picking roles are not bound by their own rank.
function checkGuildRole(guild, role, botMember, invoker = null) {
  const invokerTopPosition = !invoker || invoker.id === guild.ownerId ? null : invoker.roles.highest.position;
  return checkAssignable({
    role: { id: role.id, managed: role.managed, position: role.position, permissions: role.permissions.bitfield },
    guildId: guild.id,
    botTopPosition: botMember.roles.highest.position,
    invokerTopPosition,
    protectedRoleIds: PROTECTED_ROLE_IDS,
  });
}

async function resolveListedRoles(guild) {
  const botMember = await getBotMember(guild);
  const entries = store.listForGuild(guild.id);

  const stale = entries.filter(e => !guild.roles.cache.has(e.roleId)).map(e => e.roleId);
  if (stale.length > 0) {
    store.removeMany(guild.id, stale);
    logger.warn(`[SelfRoles] Pruned ${stale.length} deleted role(s) from guild ${guild.id}.`);
  }

  const usable = [];
  const blocked = [];
  for (const entry of entries) {
    const role = guild.roles.cache.get(entry.roleId);
    if (!role) continue;
    const reason = checkGuildRole(guild, role, botMember);
    if (reason) blocked.push({ ...entry, reason });
    else usable.push(entry);
  }
  return { usable, blocked };
}

module.exports = { PROTECTED_ROLE_IDS, getBotMember, checkGuildRole, resolveListedRoles };
