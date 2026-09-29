const { DAILY_COOLDOWN, WEEKLY_COOLDOWN, ROB_COOLDOWN, SLOTS_DAILY_COOLDOWN } = require("../config.js");

const DAY_MS = 86400000;

// Cooldowns store expiry, so expiry minus duration is when the command ran.
const COOLDOWN_DURATIONS = {
  daily: DAILY_COOLDOWN,
  weekly: WEEKLY_COOLDOWN,
  rob: ROB_COOLDOWN,
  freespins: SLOTS_DAILY_COOLDOWN,
};

function computeInterest(bank, tiers) {
  if (!(bank > 0)) return 0;
  let floor = 0;
  let total = 0;
  for (const { upTo, ratePercent } of tiers) {
    if (bank <= floor) break;
    total += ((Math.min(bank, upTo) - floor) * ratePercent) / 100;
    floor = upTo;
  }
  return Math.floor(total);
}

function lastActiveAt(user) {
  const recorded = Number(user?.stats?.lastCommand?.at);
  if (recorded > 0) return recorded;
  const cooldowns = user?.cooldowns || {};
  return Object.entries(COOLDOWN_DURATIONS).reduce((latest, [key, duration]) => {
    const expiresAt = Number(cooldowns[key]);
    return expiresAt > 0 ? Math.max(latest, expiresAt - duration) : latest;
  }, 0);
}

function isActive(user, now, windowDays) {
  const last = lastActiveAt(user);
  return last > 0 && now - last <= windowDays * DAY_MS;
}

function describeTiers(tiers) {
  const parts = [];
  let floor = 0;
  for (const { upTo, ratePercent } of tiers) {
    if (floor === 0) parts.push(`${ratePercent}% on the first ${upTo.toLocaleString("en-US")}`);
    else if (upTo === Infinity) parts.push(`${ratePercent}% on everything above ${floor.toLocaleString("en-US")}`);
    else parts.push(`${ratePercent}% from ${floor.toLocaleString("en-US")} up to ${upTo.toLocaleString("en-US")}`);
    floor = upTo;
  }
  return parts.join(", ");
}

module.exports = { computeInterest, lastActiveAt, isActive, describeTiers };
