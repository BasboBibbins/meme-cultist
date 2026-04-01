
const userCooldowns = new Map();
const mentionCooldowns = new Map();
let requestTimestamps = [];
const {USER_COOLDOWN, MENTION_COOLDOWN, GLOBAL_LIMIT, WINDOW_SIZE} = require("../config.json")

module.exports = {
  canProceed(userId, isMention = false) {
    const now = Date.now();
    const cooldown = isMention ? MENTION_COOLDOWN : USER_COOLDOWN;
    const cooldownMap = isMention ? mentionCooldowns : userCooldowns;

    const lastUsed = cooldownMap.get(userId) || 0;
    if (now - lastUsed < cooldown * 1000) {
      const remaining = Math.ceil((cooldown * 1000 - (now - lastUsed)) / 1000);
      return { allowed: false, reason: `Too many requests! Please wait ${remaining}s before next use.` };
    }

    requestTimestamps = requestTimestamps.filter(ts => now - ts < WINDOW_SIZE * 1000);
    if (requestTimestamps.length >= GLOBAL_LIMIT) {
      const retryIn = Math.ceil(
        (WINDOW_SIZE * 1000 - (now - requestTimestamps[0])) / 1000
      );
      return {
        allowed: false,
        reason: `Global rate limit reached! Try again in ${retryIn}s.`,
      };
    }

    cooldownMap.set(userId, now);
    requestTimestamps.push(now);
    return { allowed: true };
  },
};
