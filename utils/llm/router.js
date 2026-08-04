// Provider router. Today every task maps to a single adapter; future routing
// (cost-aware fallback, health-aware skipping) lands here.
//
// Each adapter call is wrapped uniformly with retry + timeout. Adapters
// themselves stay retry-naive.

const config = require("../../config.js");
const logger = require("../logger");
const { withTimeout, retryWithBackoff } = require("./retry");
const { estimateCost } = require("./cost");
const deepseek = require("./adapters/deepseek");
const gemini = require("./adapters/gemini");
const cloudflare = require("./adapters/cloudflare");
const embedCache = require("./embedCache");
const health = require("./health");
const { embedBreaker, breakerOpenError } = require("./breaker");
const { classifyToolError } = require("../toolErrors");

// In-memory per-variant cache stats. Populated by chat() when callers pass
// args.variant. Exposed via getCacheStats() for a future /admin command.
const _cacheStats = new Map();
function recordCacheStats(variant, usage) {
  if (!variant || !usage) return;
  const hit = usage.prompt_cache_hit_tokens || 0;
  const miss = usage.prompt_cache_miss_tokens || 0;
  const entry = _cacheStats.get(variant) || { hit: 0, miss: 0, calls: 0, completion: 0, cost: 0 };
  entry.hit += hit;
  entry.miss += miss;
  entry.calls += 1;
  entry.completion += usage.completion_tokens || 0;
  entry.cost += Number(estimateCost({ usage }));
  _cacheStats.set(variant, entry);
  const ratio = ((entry.hit / Math.max(1, entry.hit + entry.miss)) || 0).toFixed(2);
  logger.debug(`[cache] variant=${variant} hit=${hit} miss=${miss} cum_ratio=${ratio} calls=${entry.calls}`);
}
function getCacheStats() {
  const out = {};
  for (const [k, v] of _cacheStats.entries()) out[k] = { ...v };
  return out;
}
function resetCacheStats() {
  _cacheStats.clear();
}

// Health is recorded here, once, after the retry ladder resolves — one logical
// call is one health sample, not one per attempt. Every operation except
// chatStream passes through this function, so this is the only place that needs
// to know about it.
async function _run(label, fn, { timeoutMs, retries, baseDelay, provider } = {}) {
  const start = Date.now();
  const effectiveTimeout = timeoutMs ?? config.LLM_DEFAULT_TIMEOUT_MS ?? 60000;
  const effectiveRetries = retries ?? config.LLM_MAX_RETRIES ?? 3;
  try {
    const out = await retryWithBackoff(
      () => withTimeout(fn(), effectiveTimeout, `${label} timed out (${effectiveTimeout}ms)`),
      effectiveRetries,
      baseDelay ?? 1000,
    );
    if (provider) health.record(provider, { ok: true, latency_ms: Date.now() - start });
    return { out, latency_ms: Date.now() - start };
  } catch (err) {
    if (provider) {
      health.record(provider, { ok: false, latency_ms: Date.now() - start, code: classifyToolError(err) });
    }
    throw err;
  }
}

async function chat(args) {
  const label = args.label || "chat";
  const { out, latency_ms } = await _run(label, () => deepseek.chat(args), {
    timeoutMs: args.timeoutMs,
    retries: args.retries,
    baseDelay: args.baseDelay,
    provider: "deepseek",
  });
  if (args.variant) recordCacheStats(args.variant, out.usage);
  return {
    result: out.result,
    usage: { ...out.usage, cost_usd: estimateCost({ usage: out.usage }) },
    latency_ms,
    raw: out.raw,
  };
}

async function describeImage(args) {
  const { out, latency_ms } = await _run("describeImage", () => gemini.describeImage(args), {
    timeoutMs: args.timeoutMs ?? 30000,
    retries: args.retries ?? 1,
    provider: "gemini",
  });
  return { ...out, latency_ms };
}

async function generateImage(args) {
  const { out, latency_ms } = await _run("generateImage", () => cloudflare.generateImage(args), {
    timeoutMs: args.timeoutMs ?? 60000,
    retries: args.retries ?? 1,
    provider: "cloudflare",
  });
  return { ...out, latency_ms };
}

async function embed(args) {
  // A cache hit must never reach the health ring: it makes no network call, so
  // recording it as a 0 ms success would flood the ring with fake wins and mask
  // a dead endpoint entirely. The early return keeps that automatic — do not
  // move health recording above this line.
  //
  // `noCache` exists for the health probe, which would otherwise be answered
  // from cache after its first run and stop measuring anything.
  if (!args.noCache) {
    const cached = embedCache.get(args.text);
    if (cached) return { embedding: cached, latency_ms: 0, cached: true };
  }

  // Checked after the cache so a cached hit is served even while the breaker is
  // open — there is no upstream to protect on that path.
  if (embedBreaker.shouldShortCircuit()) throw breakerOpenError("embed");

  try {
    const { out, latency_ms } = await _run("embed", () => cloudflare.embedText(args), {
      timeoutMs: args.timeoutMs ?? 30000,
      retries: args.retries ?? 2,
      provider: "cloudflare",
    });
    embedBreaker.recordSuccess();
    if (!args.noCache) embedCache.set(args.text, out.embedding);
    return { ...out, latency_ms };
  } catch (err) {
    embedBreaker.recordFailure(err);
    throw err;
  }
}

// Streaming does not retry automatically (mid-stream retry would require
// replaying any text already shown to the user). The router still applies a
// first-chunk timeout and a per-chunk inactivity watchdog so a stalled
// upstream cannot hang a Discord reply indefinitely, and emits latency /
// chunk-count telemetry on completion to match the non-streaming `chat()`
// observability.
async function* chatStream(args) {
  const label = args.label || "chatStream";
  const firstChunkMs = args.timeoutMs ?? config.LLM_DEFAULT_TIMEOUT_MS ?? 60000;
  const idleMs = args.streamIdleTimeoutMs ?? config.LLM_STREAM_IDLE_TIMEOUT_MS ?? 30000;
  const start = Date.now();
  let firstChunkAt = null;
  let chunks = 0;
  let usage = null;
  let streamHealthRecorded = false;

  const inner = deepseek.chatStream(args);
  const iter = inner[Symbol.asyncIterator]();

  try {
    while (true) {
      const waitMs = firstChunkAt === null ? firstChunkMs : idleMs;
      const next = iter.next();
      const timeoutErr = new Error(
        firstChunkAt === null
          ? `${label} first chunk timed out (${waitMs}ms)`
          : `${label} stalled — no chunk for ${waitMs}ms`
      );
      let step;
      try {
        step = await withTimeout(next, waitMs, timeoutErr);
      } catch (err) {
        // Best-effort close the upstream iterator so the socket releases.
        try { await iter.return?.(); } catch (_) {}
        logger.warn(`[llm] ${label} stream aborted after ${Date.now() - start}ms (${chunks} chunks): ${err.message}`);
        // Streaming does not pass through _run, so health is recorded here
        // instead. A stream that yielded chunks before dying still delivered
        // value, so only a zero-chunk abort counts as a failed call.
        health.record("deepseek", {
          ok: chunks > 0,
          latency_ms: Date.now() - start,
          code: classifyToolError(err),
        });
        streamHealthRecorded = true;
        throw err;
      }
      if (step.done) break;
      if (firstChunkAt === null) firstChunkAt = Date.now();
      chunks += 1;
      if (step.value?.usage) usage = step.value.usage;
      yield step.value;
    }
  } finally {
    const total = Date.now() - start;
    const ttfb = firstChunkAt !== null ? firstChunkAt - start : null;
    logger.debug(`[llm] ${label} stream done chunks=${chunks} ttfb_ms=${ttfb ?? "n/a"} total_ms=${total}`);
    if (args.variant) recordCacheStats(args.variant, usage);
    if (!streamHealthRecorded) health.record("deepseek", { ok: true, latency_ms: total });
  }
}

module.exports = {
  chat, chatStream, describeImage, generateImage, embed,
  getCacheStats, resetCacheStats,
  getHealth: health.snapshotAll, isDegraded: health.isDegraded, resetHealth: health.reset,
  getBreakerState: () => embedBreaker.snapshot(), resetBreaker: () => embedBreaker.reset(),
};
