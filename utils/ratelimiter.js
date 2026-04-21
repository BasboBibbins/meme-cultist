const logger = require("./logger");
const { formatChatbotChannelMentions } = require("./channels");

const userCooldowns = new Map();
const mentionCooldowns = new Map();
const imageGenTimestamps = new Map();
let requestTimestamps = [];
let requestCount = 0;

const {USER_COOLDOWN, MENTION_COOLDOWN, GLOBAL_LIMIT, WINDOW_SIZE, IMAGE_GEN_LIMIT, IMAGE_GEN_WINDOW} = require("../config.js")

function cleanupTimestamps() {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter(ts => now - ts < WINDOW_SIZE * 1000);
}

function canProceed(client, userId, isMention = false) {
  const now = Date.now();
  const cooldown = isMention ? MENTION_COOLDOWN : USER_COOLDOWN;
  const cooldownMap = isMention ? mentionCooldowns : userCooldowns;

  // Per-user cooldown check
  const lastUsed = cooldownMap.get(userId) || 0;
  if (now - lastUsed < cooldown * 1000) {
    const remaining = Math.ceil((cooldown * 1000 - (now - lastUsed)) / 1000);
    const channelText = formatChatbotChannelMentions(client);
    return { allowed: false, reason: `Too many requests! Please wait ${remaining}s before next use, or use ${channelText}` };
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

function canGenerateImage(userId) {
  const now = Date.now();
  const windowMs = IMAGE_GEN_WINDOW * 1000;
  const history = (imageGenTimestamps.get(userId) || []).filter(ts => now - ts < windowMs);

  if (history.length >= IMAGE_GEN_LIMIT) {
    const retryIn = Math.ceil((windowMs - (now - history[0])) / 1000);
    imageGenTimestamps.set(userId, history);
    return {
      allowed: false,
      reason: `Image generation limit reached (${IMAGE_GEN_LIMIT} per ${Math.round(IMAGE_GEN_WINDOW / 60)} min). Try again in ${retryIn}s.`,
      retryIn,
    };
  }

  history.push(now);
  imageGenTimestamps.set(userId, history);
  return { allowed: true };
}

module.exports = {
  canProceed,
  cleanupTimestamps,
  canGenerateImage,
};