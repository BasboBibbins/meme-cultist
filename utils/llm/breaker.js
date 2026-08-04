// Circuit breaker for provider calls. Only the embed instance is wired today;
// the shape is generic because image generation is the obvious second user.
//
// Without this, a degraded embedding endpoint costs the same full retry ladder on
// every single call — and since lookup_kb and search_history run *inside* a
// chatbot turn, that turns a tool call into a ~90 s hang the user waits through,
// repeatedly, for as long as the outage lasts.
//
// The retrieval layer is already built to survive this: FTS is primary in the
// archive and episode stores, and the KB gained a lexical fallback. The bot can
// serve degraded results indefinitely. It just had no way to *decide* to.
//
// State is in memory. A restart starts CLOSED, which is correct — a restart is
// exactly when you want to re-test the assumption.

const config = require("../../config.js");
const logger = require("../logger");
const health = require("./health");
const { CODES, classifyToolError } = require("../toolErrors");

const STATES = { CLOSED: "closed", OPEN: "open", HALF_OPEN: "half_open" };

// A misconfigured key or a malformed request is not a capacity problem. Opening
// on those would hide a permanent misconfiguration behind a breaker that looks
// like it is healing itself on a timer.
const NON_TRIPPING = new Set([CODES.INVALID_INPUT, CODES.AUTH, CODES.NOT_CONFIGURED, CODES.NOT_FOUND]);

function createBreaker({ name, provider, cooldownMs, enabled }) {
  let state = STATES.CLOSED;
  let openedAt = null;
  let trips = 0;
  let probeInFlight = false;
  // Set by the owner at startup. A hook rather than a direct call so this module
  // stays unaware of the job queue and reusable for non-queue-backed providers.
  let onClose = null;

  function isEnabled() {
    return enabled() !== false;
  }

  function cooldown() {
    return cooldownMs();
  }

  function open(reason) {
    if (state !== STATES.OPEN) {
      trips += 1;
      logger.warn(`[breaker:${name}] OPEN — ${reason}. Short-circuiting for ${Math.round(cooldown() / 60000)} min.`);
    }
    state = STATES.OPEN;
    openedAt = Date.now();
    probeInFlight = false;
  }

  function close(reason) {
    const wasOpen = state !== STATES.CLOSED;
    if (wasOpen) logger.log(`[breaker:${name}] CLOSED — ${reason}.`);
    state = STATES.CLOSED;
    openedAt = null;
    probeInFlight = false;
    if (wasOpen && onClose) {
      // Never let a recovery hook re-open the breaker it is recovering from.
      try { onClose(); } catch (err) { logger.error(`[breaker:${name}] onClose hook failed: ${err.message}`); }
    }
  }

  // Resolves OPEN → HALF_OPEN once the cooldown has elapsed. Called on every
  // check rather than on a timer so there is no interval to leak.
  function currentState() {
    if (!isEnabled()) return STATES.CLOSED;
    if (state === STATES.OPEN && openedAt !== null && Date.now() - openedAt >= cooldown()) {
      state = STATES.HALF_OPEN;
      probeInFlight = false;
      logger.log(`[breaker:${name}] HALF_OPEN — cooldown elapsed, allowing one trial call.`);
    }
    return state;
  }

  // True when the call should be short-circuited. HALF_OPEN lets exactly one
  // caller through: the queue tick and an interactive tool call can race, and two
  // simultaneous probes against a still-dead endpoint would defeat the point.
  function shouldShortCircuit() {
    const s = currentState();
    if (s === STATES.CLOSED) return false;
    if (s === STATES.OPEN) return true;
    if (probeInFlight) return true;
    probeInFlight = true;
    return false;
  }

  function recordSuccess() {
    if (!isEnabled()) return;
    if (state === STATES.HALF_OPEN) close("trial call succeeded");
    probeInFlight = false;
  }

  function recordFailure(err) {
    if (!isEnabled()) return;
    const code = classifyToolError(err);
    if (NON_TRIPPING.has(code)) {
      probeInFlight = false;
      return;
    }
    if (state === STATES.HALF_OPEN) {
      open(`trial call failed (${code})`);
      return;
    }
    // Otherwise defer to the health ring, which owns the sample floor and the
    // thresholds — the breaker does not keep a second opinion about liveness.
    if (health.isDegraded(provider)) open(`${provider} degraded (last: ${code})`);
  }

  function snapshot() {
    const s = currentState();
    return {
      name,
      state: s,
      trips,
      openedAt,
      msInState: openedAt ? Date.now() - openedAt : null,
      enabled: isEnabled(),
    };
  }

  function reset() {
    state = STATES.CLOSED;
    openedAt = null;
    trips = 0;
    probeInFlight = false;
  }

  function setOnClose(fn) {
    onClose = fn;
  }

  return { shouldShortCircuit, recordSuccess, recordFailure, snapshot, reset, currentState, setOnClose, STATES };
}

const embedBreaker = createBreaker({
  name: "embed",
  provider: "cloudflare",
  cooldownMs: () => (config.EMBED_BREAKER_COOLDOWN_MIN ?? 10) * 60 * 1000,
  enabled: () => config.EMBED_BREAKER_ENABLED,
});

// Thrown instead of returned as a sentinel: all six embed call sites already
// wrap router.embed() in try/catch because it could always fail, so an exception
// needs zero new branches where a sentinel would need six. The code makes the
// §5.12 taxonomy produce the right user-facing sentence for free.
function breakerOpenError(name) {
  const err = new Error(`${name} circuit breaker is open — upstream is unavailable.`);
  err.code = "BREAKER_OPEN";
  err.error_code = CODES.UPSTREAM_UNAVAILABLE;
  err.breakerOpen = true;
  return err;
}

module.exports = { createBreaker, embedBreaker, breakerOpenError, STATES, NON_TRIPPING };
