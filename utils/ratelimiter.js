const logger = require("./logger");

const imageGenTimestamps = new Map();
const mentionTimestamps = new Map();

// Per-user chatbot turn state for the reply-gated + burst-cap throttler.
// Shape: { inFlight: boolean, inFlightSince: number, turns: number[] }
const chatTurns = new Map();

const {
  IMAGE_GEN_LIMIT,
  IMAGE_GEN_WINDOW,
  MENTION_LIMIT,
  MENTION_WINDOW,
  CHAT_INFLIGHT_TIMEOUT_MS,
  CHAT_BURST_LIMIT,
  CHAT_BURST_WINDOW_MS,
} = require("../config.js");

function canMentionBot(userId) {
  const now = Date.now();
  const windowMs = MENTION_WINDOW * 1000;
  const history = (mentionTimestamps.get(userId) || []).filter(ts => now - ts < windowMs);

  if (history.length >= MENTION_LIMIT) {
    const retryIn = Math.ceil((windowMs - (now - history[0])) / 1000);
    const retryAt = Math.floor((now + retryIn * 1000) / 1000);
    mentionTimestamps.set(userId, history);
    return {
      allowed: false,
      reason: `Mention limit reached (${MENTION_LIMIT} per hour). Try again <t:${retryAt}:R>.`,
      retryIn,
    };
  }

  history.push(now);
  mentionTimestamps.set(userId, history);
  return { allowed: true };
}

function canGenerateImage(userId) {
  const now = Date.now();
  const windowMs = IMAGE_GEN_WINDOW * 1000;
  const history = (imageGenTimestamps.get(userId) || []).filter(ts => now - ts < windowMs);

  if (history.length >= IMAGE_GEN_LIMIT) {
    const retryIn = Math.ceil((windowMs - (now - history[0])) / 1000);
    const retryAt = Math.floor((now + retryIn * 1000) / 1000);
    imageGenTimestamps.set(userId, history);
    return {
      allowed: false,
      reason: `Image generation limit reached (${IMAGE_GEN_LIMIT} per ${Math.round(IMAGE_GEN_WINDOW / 60)} min). Try again <t:${retryAt}:R>.`,
      retryIn,
    };
  }

  history.push(now);
  imageGenTimestamps.set(userId, history);
  return { allowed: true };
}

// Reply-gated + burst-cap chatbot throttle. Two independent guards:
//   1. In-flight gate: a user cannot start a new chatbot turn until the bot
//      has finished replying to their previous one (or the in-flight stale
//      timeout fires, so a thrown handler doesn't permanently jam the user).
//   2. Burst cap: rolling window of completed turns. Prevents long-tail abuse
//      where a user types fast turn-by-turn for hours.
//
// Call `beginChatTurn(userId)` BEFORE handing the message to the chatbot
// pipeline. If allowed, the caller MUST eventually invoke `endChatTurn(userId)`
// — wrap the handler in try/finally so a thrown error still releases the lock.
function beginChatTurn(userId) {
  const now = Date.now();
  const state = chatTurns.get(userId) || { inFlight: false, inFlightSince: 0, turns: [] };

  if (state.inFlight) {
    const elapsed = now - state.inFlightSince;
    if (elapsed < CHAT_INFLIGHT_TIMEOUT_MS) {
      const retryAt = Math.floor((state.inFlightSince + CHAT_INFLIGHT_TIMEOUT_MS) / 1000);
      return {
        allowed: false,
        reason: `I'm still finishing your last message — wait for me to reply before sending another. (auto-clears <t:${retryAt}:R>)`,
      };
    }
    // Stale in-flight: previous turn never called endChatTurn (handler threw
    // somewhere upstream, or the bot was restarted mid-turn). Reset and let
    // this turn through; log so we know it happened.
    logger.warn(`[ChatTurn] Stale in-flight for user ${userId} (${elapsed}ms); auto-clearing.`);
    state.inFlight = false;
  }

  state.turns = state.turns.filter(ts => now - ts < CHAT_BURST_WINDOW_MS);
  if (state.turns.length >= CHAT_BURST_LIMIT) {
    const retryAt = Math.floor((state.turns[0] + CHAT_BURST_WINDOW_MS) / 1000);
    const windowMin = Math.round(CHAT_BURST_WINDOW_MS / 60000);
    chatTurns.set(userId, state);
    return {
      allowed: false,
      reason: `Slow down — you've sent ${CHAT_BURST_LIMIT} messages in the last ${windowMin} min. Try again <t:${retryAt}:R>.`,
    };
  }

  state.inFlight = true;
  state.inFlightSince = now;
  chatTurns.set(userId, state);
  return { allowed: true };
}

function endChatTurn(userId) {
  const state = chatTurns.get(userId);
  if (!state) return;
  state.inFlight = false;
  state.inFlightSince = 0;
  state.turns.push(Date.now());
  // Cheap bound: trim turns to window each end-of-turn so the array never
  // grows past CHAT_BURST_LIMIT for an active user.
  const cutoff = Date.now() - CHAT_BURST_WINDOW_MS;
  state.turns = state.turns.filter(ts => ts >= cutoff);
  chatTurns.set(userId, state);
}

module.exports = {
  canGenerateImage,
  canMentionBot,
  beginChatTurn,
  endChatTurn,
};
