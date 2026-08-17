// Token counting and DeepSeek cost estimation. Kept in the provider layer
// because the cache-hit/miss split is a DeepSeek-specific billing artifact.
// Pricing source: https://api-docs.deepseek.com/quick_start/pricing/

function estimateTokenCount(text) {
  if (!text) return 0;
  // CJK characters tokenize at ~1 char/token
  const cjk = (text.match(/[一-龥぀-ヿ가-힯]/g) ?? []).length;
  // Numbers are isolated in groups of 1-3 digits by DeepSeek's pre-tokenizer
  const digits = (text.match(/\p{N}{1,3}/gu) ?? []).length;
  // Remaining text (latin, punctuation, spaces) averages ~3.5 chars/token
  const remaining = text.length - cjk - (text.match(/\p{N}/gu) ?? []).length;
  return Math.ceil(cjk + digits + remaining / 3.5);
}

// USD per 1M tokens: [cache hit input, cache miss input, output].
const MODEL_PRICING = {
  "deepseek-v4-flash": [0.0028, 0.14, 0.28],
  "deepseek-v4-pro": [0.003625, 0.435, 0.87],
};
// Unlisted legacy ids, mapped so a reasoning model is never costed as the cheap one.
const LEGACY_PRICING = {
  "deepseek-chat": "deepseek-v4-flash",
  "deepseek-reasoner": "deepseek-v4-pro",
};
const DEFAULT_MODEL = "deepseek-v4-flash";

function pricingFor(model) {
  if (!model) return MODEL_PRICING[DEFAULT_MODEL];
  const resolved = LEGACY_PRICING[model] || model;
  return MODEL_PRICING[resolved] || MODEL_PRICING[DEFAULT_MODEL];
}

function estimateCost(apiResponse, model) {
  const usage = apiResponse.usage || {};
  const promptTokensHit = usage.prompt_cache_hit_tokens || 0;
  const promptTokensMissed = usage.prompt_cache_miss_tokens || 0;
  // Reasoning tokens bill as output; folded into completion_tokens unless absent.
  const completionTokens = (usage.completion_tokens || 0) +
    (usage.completion_tokens_details?.reasoning_tokens && !usage.completion_tokens
      ? usage.completion_tokens_details.reasoning_tokens
      : 0);
  const [hitRate, missRate, outRate] = pricingFor(model);
  const cost = (promptTokensHit * hitRate + promptTokensMissed * missRate + completionTokens * outRate) / 1_000_000;
  return cost.toFixed(6);
}

module.exports = { estimateTokenCount, estimateCost, MODEL_PRICING };
