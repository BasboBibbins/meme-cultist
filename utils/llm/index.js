// Public surface for the LLM provider layer. Every caller in the bot that
// needs to invoke an external AI model should go through this module — not
// the adapters directly — so retry/timeout/cost/cache-stats are uniform.

const router = require("./router");
const embedCache = require("./embedCache");
const { estimateCost, estimateTokenCount } = require("./cost");

module.exports = {
  chat: router.chat,
  chatStream: router.chatStream,
  describeImage: router.describeImage,
  generateImage: router.generateImage,
  embed: router.embed,
  getCacheStats: router.getCacheStats,
  resetCacheStats: router.resetCacheStats,
  getHealth: router.getHealth,
  isDegraded: router.isDegraded,
  resetHealth: router.resetHealth,
  getBreakerState: router.getBreakerState,
  resetBreaker: router.resetBreaker,
  closeEmbedCache: embedCache.close,
  estimateCost,
  estimateTokenCount,
};
