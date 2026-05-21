// Shared retry / timeout primitives for the LLM provider layer. Adapters
// stay retry-naive; the router wraps them with these helpers so retry policy
// is uniform across providers.

const logger = require("../logger");

function withTimeout(promise, ms, err = "Request timed out") {
  let handle;
  const timeout = new Promise((_, reject) => {
    handle = setTimeout(() => reject(err), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(handle));
}

function isTransientError(error) {
  if (!error) return false;
  if (error.code === "ECONNRESET" || error.code === "ETIMEDOUT" || error.code === "ENOTFOUND") return true;
  if (error.message?.includes("timeout") || error.message?.includes("network")) return true;
  if (error.response?.status >= 500 && error.response?.status < 600) return true;
  if (error.response?.status === 429) return true;
  return false;
}

async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries || !isTransientError(error)) {
        throw error;
      }
      const delay = baseDelay * Math.pow(2, attempt);
      logger.warn(`Transient error on attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${delay}ms: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

module.exports = { withTimeout, retryWithBackoff, isTransientError };
