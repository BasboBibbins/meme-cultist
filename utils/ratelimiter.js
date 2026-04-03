const logger = require("./logger");

const userCooldowns = new Map();
const mentionCooldowns = new Map();
let requestTimestamps = [];
let requestCount = 0;

const {USER_COOLDOWN, MENTION_COOLDOWN, GLOBAL_LIMIT, WINDOW_SIZE, CHATBOT_CHANNEL} = require("../config.js")

/**
 * Clean up expired timestamps from the request array.
 * This prevents memory growth over time.
 */
function cleanupTimestamps() {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter(ts => now - ts < WINDOW_SIZE * 1000);
}

/**
 * Check if a user can proceed with a request.
 * Implements per-user cooldown and global rate limiting with race condition protection.
 *
 * @param {string} userId - The Discord user ID
 * @param {boolean} isMention - Whether this is a mention (uses longer cooldown)
 * @returns {{allowed: boolean, reason?: string}}
 */
function canProceed(client, userId, isMention = false) {
  const now = Date.now();
  const cooldown = isMention ? MENTION_COOLDOWN : USER_COOLDOWN;
  const cooldownMap = isMention ? mentionCooldowns : userCooldowns;

  const mentionChannelId = CHATBOT_CHANNEL;
  const mentionChannel = client.channels.cache.get(mentionChannelId);
  const mentionChannelMention = mentionChannel ? `<#${mentionChannelId}>` : "the dedicated chatbot channel";

  // Per-user cooldown check
  const lastUsed = cooldownMap.get(userId) || 0;
  if (now - lastUsed < cooldown * 1000) {
    const remaining = Math.ceil((cooldown * 1000 - (now - lastUsed)) / 1000);
    return { allowed: false, reason: `Too many requests! Please wait ${remaining}s before next use, or use ${mentionChannelMention}` };
  }

  // Clean up expired timestamps periodically (every 100 requests)
  requestCount++;
  if (requestCount % 100 === 0) {
    cleanupTimestamps();
  }

  // Global rate limit check
  // Filter out expired timestamps first
  requestTimestamps = requestTimestamps.filter(ts => now - ts < WINDOW_SIZE * 1000);

  // Check if we're at the limit BEFORE adding our timestamp (race condition fix)
  if (requestTimestamps.length >= GLOBAL_LIMIT) {
    const retryIn = Math.ceil(
      (WINDOW_SIZE * 1000 - (now - requestTimestamps[0])) / 1000
    );
    return {
      allowed: false,
      reason: `Global rate limit reached! Try again in ${retryIn}s.`,
    };
  }

  // Warn when approaching global limit (80% threshold)
  if (requestTimestamps.length >= GLOBAL_LIMIT * 0.8) {
    logger.warn(`Rate limiter at ${Math.round(requestTimestamps.length / GLOBAL_LIMIT * 100)}% capacity (${requestTimestamps.length}/${GLOBAL_LIMIT})`);
  }

  // Record timestamps after passing all checks
  cooldownMap.set(userId, now);
  requestTimestamps.push(now);

  return { allowed: true };
}

module.exports = {
  canProceed,
  cleanupTimestamps,
};