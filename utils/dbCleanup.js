const { lastActiveAt, isActive } = require("./interest");

const DAY_MS = 86400000;

function isPlayerRow(row) {
  return !!row && typeof row === "object" && "bank" in row;
}

function holdings(row) {
  return Math.max(0, Number(row?.balance) || 0) + Math.max(0, Number(row?.bank) || 0);
}

// Yearly counters only fill from the user's own commands, so a non-empty set proves activity since Jan 1.
function effectiveLastActive(user, now) {
  const commands = user?.stats?.commands || {};
  const year = new Date(now).getFullYear();
  const usedThisYear = String(commands.yearlyReset) === String(year)
    && Object.values(commands.yearly || {}).some(n => Number(n) > 0);
  return Math.max(lastActiveAt(user), usedThisYear ? new Date(year, 0, 1).getTime() : 0);
}

function isLongInactive(user, now, days) {
  return now - effectiveLastActive(user, now) > days * DAY_MS;
}

function planCleanup(rows, { memberIds, botIds, now, inactiveDays, activeDays }) {
  const departed = [];
  const inactive = [];
  const recipients = [];
  for (const { id, value } of rows) {
    const entry = { id, name: value?.name ?? id, amount: isPlayerRow(value) ? holdings(value) : 0 };
    if (!memberIds.has(id)) departed.push(entry);
    else if (!isPlayerRow(value)) continue;
    else if (isLongInactive(value, now, inactiveDays)) {
      if (entry.amount > 0) inactive.push(entry);
    } else if (!botIds.has(id) && isActive(value, now, activeDays)) recipients.push(id);
  }
  const byAmount = (a, b) => b.amount - a.amount;
  departed.sort(byAmount);
  inactive.sort(byAmount);
  const total = [...departed, ...inactive].reduce((sum, e) => sum + e.amount, 0);
  return { departed, inactive, recipients, total };
}

function splitPot(total, recipientCount, jackpotShare) {
  if (!(total > 0)) return { jackpot: 0, perRecipient: 0 };
  if (!(recipientCount > 0)) return { jackpot: total, perRecipient: 0 };
  const playerPool = total - Math.floor(total * jackpotShare);
  const perRecipient = Math.floor(playerPool / recipientCount);
  return { jackpot: total - perRecipient * recipientCount, perRecipient };
}

module.exports = { isPlayerRow, holdings, effectiveLastActive, isLongInactive, planCleanup, splitPot };
