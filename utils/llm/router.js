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
    const hit = usage?.prompt_tokens_hit_tokens || usage?.prompt_cache_hit_tokens || 0;
    const miss = usage?.prompt_tokens_missed_tokens || usage?.prompt_cache_miss_tokens || 0;
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

async function* chatStream(args) {
    const label = args.label || "chatStream";
    // Streaming does not retry automatically; callers should fall back to
    // the non-streaming chat() if the generator throws.
    yield* deepseek.chatStream(args);
}

module.exports = { chat, chatStream, describeImage, generateImage, embed, getCacheStats };
