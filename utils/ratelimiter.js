
const userCooldowns = new Map(); 
let requestTimestamps = [];
const {USER_COOLDOWN, GLOBAL_LIMIT, WINDOW_SIZE} = require("../config.json")

module.exports = {
  canProceed(userId) {
    const now = Date.now();

    const lastUsed = userCooldowns.get(userId) || 0;
    if (now - lastUsed < USER_COOLDOWN) {
      const remaining = Math.ceil((USER_COOLDOWN - (now - lastUsed)) / 1000);
      return { allowed: false, reason: `Too many requests! Please wait ${remaining}s before next use.` };
    }

    requestTimestamps = requestTimestamps.filter(ts => now - ts < WINDOW_SIZE);
    if (requestTimestamps.length >= GLOBAL_LIMIT) {
      const retryIn = Math.ceil(
        (WINDOW_SIZE - (now - requestTimestamps[0])) / 1000
      );
      return {
        allowed: false,
        reason: `Global rate limit reached! Try again in ${retryIn}s.`,
      };
    }

    userCooldowns.set(userId, now);
    requestTimestamps.push(now);
    return { allowed: true };
  },
};
