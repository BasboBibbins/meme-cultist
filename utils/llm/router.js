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

// In-memory per-variant cache stats. Populated by chat() when callers pass
// args.variant. Exposed via getCacheStats() for a future /admin command.
const _cacheStats = new Map();
function recordCacheStats(variant, usage) {
  if (!variant) return;
  const hit = usage?.prompt_cache_hit_tokens || 0;
  const miss = usage?.prompt_cache_miss_tokens || 0;
  const entry = _cacheStats.get(variant) || { hit: 0, miss: 0, calls: 0 };
  entry.hit += hit;
  entry.miss += miss;
  entry.calls += 1;
  _cacheStats.set(variant, entry);
  const ratio = ((entry.hit / Math.max(1, entry.hit + entry.miss)) || 0).toFixed(2);
  logger.debug(`[cache] variant=${variant} hit=${hit} miss=${miss} cum_ratio=${ratio} calls=${entry.calls}`);
}
function getCacheStats() {
  const out = {};
  for (const [k, v] of _cacheStats.entries()) out[k] = { ...v };
  return out;
}

async function _run(label, fn, { timeoutMs, retries, baseDelay } = {}) {
  const start = Date.now();
  const effectiveTimeout = timeoutMs ?? config.LLM_DEFAULT_TIMEOUT_MS ?? 60000;
  const effectiveRetries = retries ?? config.LLM_MAX_RETRIES ?? 3;
  const out = await retryWithBackoff(
    () => withTimeout(fn(), effectiveTimeout, `${label} timed out (${effectiveTimeout}ms)`),
    effectiveRetries,
    baseDelay ?? 1000,
  );
  return { out, latency_ms: Date.now() - start };
}

async function chat(args) {
  const label = args.label || "chat";
  const { out, latency_ms } = await _run(label, () => deepseek.chat(args), {
    timeoutMs: args.timeoutMs,
    retries: args.retries,
    baseDelay: args.baseDelay,
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
  });
  return { ...out, latency_ms };
}

async function generateImage(args) {
  const { out, latency_ms } = await _run("generateImage", () => cloudflare.generateImage(args), {
    timeoutMs: args.timeoutMs ?? 60000,
    retries: args.retries ?? 1,
  });
  return { ...out, latency_ms };
}

async function embed(args) {
  const { out, latency_ms } = await _run("embed", () => cloudflare.embedText(args), {
    timeoutMs: args.timeoutMs ?? 30000,
    retries: args.retries ?? 2,
  });
  return { ...out, latency_ms };
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
        throw err;
      }
      if (step.done) break;
      if (firstChunkAt === null) firstChunkAt = Date.now();
      chunks += 1;
      yield step.value;
    }
  } finally {
    const total = Date.now() - start;
    const ttfb = firstChunkAt !== null ? firstChunkAt - start : null;
    logger.debug(`[llm] ${label} stream done chunks=${chunks} ttfb_ms=${ttfb ?? "n/a"} total_ms=${total}`);
  }
}

module.exports = { chat, chatStream, describeImage, generateImage, embed, getCacheStats };
