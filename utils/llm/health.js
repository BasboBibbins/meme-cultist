// Per-provider health ring.
//
// The router has always sent every task to a fixed adapter with no idea whether
// that adapter is alive. On residential broadband one ISP hiccup cascades: every
// call pays the full retry ladder inside a 60 s timeout before failing, so the
// bot spends minutes per turn rediscovering something it learned 30 seconds ago.
//
// In-memory only. This is the highest-frequency event in the system and the Pi's
// SD card is the component most likely to die of write amplification, so nothing
// here touches disk. A restart starting from empty is correct — an empty ring
// reports healthy, which is the right assumption until proven otherwise.

const config = require("../../config.js");
const logger = require("../logger");

const PROVIDERS = ["deepseek", "gemini", "cloudflare"];

const _rings = new Map();

function ringFor(provider) {
  let ring = _rings.get(provider);
  if (!ring) {
    // Fixed-size buffer with a write cursor: appending to an array and shifting
    // would reallocate on every call.
    ring = { samples: new Array(size()), next: 0, count: 0, lastOkAt: null, lastError: null };
    _rings.set(provider, ring);
  }
  return ring;
}

function size() {
  return config.PROVIDER_HEALTH_RING_SIZE || 50;
}

function enabled() {
  return config.PROVIDER_HEALTH_ENABLED !== false;
}

// `code` is the toolErrors classification when the call failed, so lastError
// carries something meaningful rather than a raw provider string.
function record(provider, { ok, latency_ms, code } = {}) {
  if (!enabled() || !provider) return;
  const ring = ringFor(provider);
  const cap = size();
  ring.samples[ring.next % cap] = { ok: Boolean(ok), latency_ms: Number(latency_ms) || 0 };
  ring.next = (ring.next + 1) % cap;
  ring.count = Math.min(ring.count + 1, cap);
  if (ok) ring.lastOkAt = Date.now();
  else ring.lastError = { code: code || "unknown", at: Date.now() };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

// The ring holds at most PROVIDER_HEALTH_RING_SIZE entries, so sorting on read is
// cheaper than maintaining sorted order on every write.
function snapshot(provider) {
  const ring = _rings.get(provider);
  if (!ring || ring.count === 0) {
    return { provider, calls: 0, successRate: 1, p50: 0, p95: 0, lastOkAt: null, lastError: null, degraded: false };
  }
  const live = ring.samples.slice(0, ring.count).filter(Boolean);
  const ok = live.filter(s => s.ok).length;
  const latencies = live.map(s => s.latency_ms).sort((a, b) => a - b);
  const successRate = ok / live.length;
  return {
    provider,
    calls: live.length,
    successRate,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    lastOkAt: ring.lastOkAt,
    lastError: ring.lastError,
    degraded: isDegraded(provider),
  };
}

function snapshotAll() {
  const out = {};
  for (const p of PROVIDERS) out[p] = snapshot(p);
  return out;
}

// A sample floor matters more than the thresholds: two failures on a cold ring
// must never mark a provider degraded, or a restart during a blip would open
// every downstream guard at once.
function isDegraded(provider) {
  if (!enabled()) return false;
  const ring = _rings.get(provider);
  if (!ring || ring.count === 0) return false;

  const minSamples = config.PROVIDER_HEALTH_MIN_SAMPLES ?? 10;
  const live = ring.samples.slice(0, ring.count).filter(Boolean);
  if (live.length < minSamples) return false;

  const failed = live.filter(s => !s.ok).length;
  const errorRate = failed / live.length;
  if (errorRate > (config.PROVIDER_DEGRADED_ERROR_RATE ?? 0.25)) return true;

  const latencies = live.map(s => s.latency_ms).sort((a, b) => a - b);
  return percentile(latencies, 95) > (config.PROVIDER_DEGRADED_P95_MS ?? 15000);
}

// Real traffic is a better signal than a synthetic ping and should always win, so
// the probe consults this before spending anything.
function msSinceLastCall(provider) {
  const ring = _rings.get(provider);
  if (!ring || ring.count === 0) return Infinity;
  const last = Math.max(ring.lastOkAt || 0, ring.lastError?.at || 0);
  return last ? Date.now() - last : Infinity;
}

function reset() {
  _rings.clear();
}

function logSnapshot() {
  for (const [provider, snap] of Object.entries(snapshotAll())) {
    if (snap.calls === 0) continue;
    logger.debug(
      `[health] ${provider} calls=${snap.calls} ok=${(snap.successRate * 100).toFixed(0)}% ` +
      `p50=${snap.p50}ms p95=${snap.p95}ms${snap.degraded ? " DEGRADED" : ""}`
    );
  }
}

module.exports = { record, snapshot, snapshotAll, isDegraded, msSinceLastCall, reset, logSnapshot, PROVIDERS };
