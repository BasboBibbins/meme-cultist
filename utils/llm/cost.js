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

function estimateCost(apiResponse) {
  // 1M INPUT TOKENS (CACHE HIT):  $0.028
  // 1M INPUT TOKENS (CACHE MISS): $0.28
  // 1M OUTPUT TOKENS:             $0.42
  const usage = apiResponse.usage || {};
  const promptTokensHit = usage.prompt_cache_hit_tokens || 0;
  const promptTokensMissed = usage.prompt_cache_miss_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;
  const cost = (promptTokensHit * 0.028 + promptTokensMissed * 0.28 + completionTokens * 0.42) / 1_000_000;
  return cost.toFixed(6);
}

module.exports = { estimateTokenCount, estimateCost };
