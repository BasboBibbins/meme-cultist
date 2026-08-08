// Periodic provider health probe.
//
// Passive recording from real traffic covers a busy server, but a quiet one can
// go an hour without touching a provider — and then discovers an outage on the
// turn a user is waiting for. This tops the ring up when traffic doesn't.
//
// Real traffic always wins: a provider called within the probe interval is
// skipped, because an actual request is a better signal than a synthetic one and
// costs nothing extra.

const config = require("../../config.js");
const logger = require("../logger");
const health = require("./health");

// Gemini is deliberately absent. Its adapter only speaks vision, so the cheapest
// synthetic probe would be an image upload — far too expensive to run every five
// minutes for a liveness check. It relies on passive recording from real
// describeImage traffic instead.
const PROBES = {
  deepseek: async (router) => {
    await router.chat({
      // The adapter passes `model` straight through, so omitting it sends
      // `undefined` and earns a 400 — which would record a permanent synthetic
      // failure and report a healthy provider as degraded forever.
      model: config.CONVO_MODEL,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1,
      timeoutMs: 10000,
      retries: 0,
      label: "health-probe",
    });
  },
  cloudflare: async (router) => {
    // noCache matters: without it the first probe populates the cache and every
    // subsequent one is answered locally, so the probe would report a healthy
    // endpoint forever regardless of reality.
    await router.embed({ text: "health probe", noCache: true, timeoutMs: 10000, retries: 0 });
  },
};

async function probeOnce(router = require("./router")) {
  if (config.PROVIDER_HEALTH_ENABLED === false) return;
  if (config.PROVIDER_HEALTH_PROBE_ENABLED === false) return;
  // A monitoring feature must never be the thing that spends the budget.
  if (config.LOW_BUDGET_MODE) return;

  const intervalMs = (config.PROVIDER_PROBE_INTERVAL_MIN ?? 5) * 60 * 1000;

  for (const [provider, run] of Object.entries(PROBES)) {
    if (health.msSinceLastCall(provider) < intervalMs) continue;
    try {
      await run(router);
    } catch (err) {
      // The failure is already recorded by the router's health hook; this is
      // only so a probe error cannot escape into the scheduler.
      logger.debug(`[health] probe ${provider} failed: ${err.message}`);
    }
  }
  health.logSnapshot();
}

module.exports = { probeOnce, PROBES };
