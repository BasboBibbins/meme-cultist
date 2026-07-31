// Tool failure taxonomy.
//
// Tool handlers used to return raw exception text ("Cloudflare image generation
// failed: {\"errors\":[{\"code\":5006}]}"), which the model could not turn into
// anything useful — so a failed tool call often produced an empty reply and the
// user saw nothing at all. Every failure is normalized here into a code, a
// plain-language reason, and a retryable flag, so the model can explain what
// went wrong and the caller has a deterministic sentence to fall back on.
//
// Reasons are written for the user: no provider names, status codes, or raw
// payloads. Full detail stays in the logs.

const CODES = {
  RATE_LIMITED: "rate_limited",
  QUOTA_EXCEEDED: "quota_exceeded",
  TIMEOUT: "timeout",
  NETWORK: "network",
  UPSTREAM_UNAVAILABLE: "upstream_unavailable",
  UPSTREAM_ERROR: "upstream_error",
  AUTH: "auth",
  NOT_CONFIGURED: "not_configured",
  INVALID_INPUT: "invalid_input",
  NOT_FOUND: "not_found",
  NOT_PERMITTED: "not_permitted",
  EMPTY_RESULT: "empty_result",
  UNKNOWN: "unknown",
};

// What the user is told, and whether trying again is worth suggesting.
const CODE_META = {
  [CODES.RATE_LIMITED]: { retryable: true, reason: "that service is rate-limited at the moment" },
  [CODES.QUOTA_EXCEEDED]: { retryable: false, reason: "the usage allowance for that service is used up for now" },
  [CODES.TIMEOUT]: { retryable: true, reason: "that service took too long to respond" },
  [CODES.NETWORK]: { retryable: true, reason: "the connection to that service dropped" },
  [CODES.UPSTREAM_UNAVAILABLE]: { retryable: true, reason: "that service is temporarily unavailable" },
  [CODES.UPSTREAM_ERROR]: { retryable: true, reason: "that service returned an error" },
  [CODES.AUTH]: { retryable: false, reason: "access to that service was refused" },
  [CODES.NOT_CONFIGURED]: { retryable: false, reason: "that capability is not set up on this bot" },
  [CODES.INVALID_INPUT]: { retryable: false, reason: "the request was missing something it needed" },
  [CODES.NOT_FOUND]: { retryable: false, reason: "there was nothing matching that" },
  [CODES.NOT_PERMITTED]: { retryable: false, reason: "that is not allowed here" },
  [CODES.EMPTY_RESULT]: { retryable: false, reason: "the lookup came back empty" },
  [CODES.UNKNOWN]: { retryable: true, reason: "something went wrong on the way" },
};

// Ordered because several patterns overlap — 429 is a rate limit before it is
// an upstream error, and "quota" beats the generic 403 auth read.
const PATTERNS = [
  [CODES.QUOTA_EXCEEDED, /\b(quota|billing|credit|insufficient[_ ]funds|payment required|RESOURCE_EXHAUSTED)\b|\b402\b/i],
  [CODES.RATE_LIMITED, /\b(rate[ _-]?limit|too many requests|throttl)\w*\b|\b429\b/i],
  [CODES.TIMEOUT, /\b(timed? ?out|timeout|deadline exceeded|ETIMEDOUT|ESOCKETTIMEDOUT)\b/i],
  [CODES.NETWORK, /\b(ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up|network error|fetch failed)\b/i],
  [CODES.NOT_CONFIGURED, /\bis not set\b|\bnot configured\b|\bmissing (api )?key\b/i],
  [CODES.AUTH, /\b(unauthorized|forbidden|invalid[ _-]?(api[ _-]?)?key|authentication|permission denied)\b|\b40[13]\b/i],
  [CODES.UPSTREAM_UNAVAILABLE, /\b(service unavailable|bad gateway|gateway timeout|overloaded)\b|\b50[234]\b/i],
  [CODES.NOT_PERMITTED, /\bonly available in\b|\bnot allowed\b|\bcannot be used\b/i],
  [CODES.INVALID_INPUT, /\b(missing required|invalid[ _]arguments?|empty '|malformed)\b/i],
  [CODES.NOT_FOUND, /\bnot found\b|\bno such\b|\bdoes not exist\b/i],
  [CODES.EMPTY_RESULT, /\bno (matching|results?|entries|web results)\b|\bcame back empty\b/i],
];

function statusOf(err) {
  const status = err?.response?.status ?? err?.status ?? err?.statusCode;
  return Number.isInteger(status) ? status : null;
}

function codeFromStatus(status) {
  if (status === 402) return CODES.QUOTA_EXCEEDED;
  if (status === 429) return CODES.RATE_LIMITED;
  if (status === 401 || status === 403) return CODES.AUTH;
  if (status === 404) return CODES.NOT_FOUND;
  if (status === 408 || status === 504) return CODES.TIMEOUT;
  if (status === 502 || status === 503) return CODES.UPSTREAM_UNAVAILABLE;
  if (status >= 500) return CODES.UPSTREAM_ERROR;
  if (status >= 400) return CODES.INVALID_INPUT;
  return null;
}

// Accepts an Error, a plain string, or anything with a message. HTTP status
// generally wins over text matching because a status is unambiguous — except
// for quota, which arrives as a 429 but means the allowance is gone for the
// billing period, so "try again shortly" would be a lie.
function classifyToolError(err) {
  if (!err) return CODES.UNKNOWN;

  const rawText = typeof err === "string" ? err : String(err?.message ?? err ?? "");
  if (PATTERNS[0][1].test(rawText)) return CODES.QUOTA_EXCEEDED;

  const fromStatus = codeFromStatus(statusOf(err));
  if (fromStatus) return fromStatus;

  if (err.code === "ECONNRESET" || err.code === "ECONNREFUSED" || err.code === "ENOTFOUND" || err.code === "EAI_AGAIN") {
    return CODES.NETWORK;
  }
  if (err.code === "ETIMEDOUT" || err.code === "ESOCKETTIMEDOUT") return CODES.TIMEOUT;

  const text = typeof err === "string" ? err : String(err?.message ?? err ?? "");
  if (!text) return CODES.UNKNOWN;
  for (const [code, pattern] of PATTERNS) {
    if (pattern.test(text)) return code;
  }
  return CODES.UNKNOWN;
}

function metaFor(code) {
  return CODE_META[code] || CODE_META[CODES.UNKNOWN];
}

// The deterministic last resort, used when no model-generated explanation could
// be produced. Reads as a complete sentence on its own.
function describeToolFailure(code, toolName) {
  const { retryable, reason } = metaFor(code);
  const what = toolName ? `I couldn't finish that ${humanizeTool(toolName)}` : "I couldn't finish that";
  const tail = retryable ? " Give it another shot in a moment." : "";
  return `${what} — ${reason}.${tail}`;
}

const TOOL_NOUNS = {
  generate_image: "image request",
  web_search: "web search",
  fetch_page: "page lookup",
  lookup_kb: "knowledge base lookup",
  search_history: "history search",
  recall_episode: "memory lookup",
  set_reminder: "reminder",
  get_balance: "balance lookup",
  get_leaderboard: "leaderboard lookup",
  get_user_stats: "stats lookup",
};

function humanizeTool(toolName) {
  return TOOL_NOUNS[toolName] || "lookup";
}

// Turns any handler outcome into the shape the model reasons about. `error`
// stays a plain string so existing truthiness checks keep working; the code,
// retryable flag and guidance are additive.
function normalizeToolError(toolName, err, { code: forcedCode } = {}) {
  const code = forcedCode || classifyToolError(err);
  const { retryable, reason } = metaFor(code);
  return {
    error: `The ${humanizeTool(toolName)} failed because ${reason}.`,
    error_code: code,
    tool: toolName,
    retryable,
    guidance: retryable
      ? "Tell the user plainly what went wrong and that they can try again shortly. Do not retry the tool yourself this turn."
      : "Tell the user plainly what went wrong. Do not retry the tool — it will fail the same way.",
  };
}

// A result is a failure if a handler set `error`. Handlers that already return a
// deliberate, user-safe message keep it; only the metadata is filled in.
function isToolError(result) {
  return Boolean(result && typeof result === "object" && result.error);
}

// Handlers return their own wording for expected refusals ("only available in
// chatbot channels"), which is better than a generic sentence — so that text is
// preserved and only the classification is attached.
function decorateToolError(toolName, result) {
  if (!isToolError(result) || result.error_code) return result;
  const code = classifyToolError(result.error);
  const { retryable } = metaFor(code);
  return {
    ...result,
    error_code: code,
    tool: toolName,
    retryable,
    guidance: retryable
      ? "Tell the user plainly what went wrong and that they can try again shortly. Do not retry the tool yourself this turn."
      : "Tell the user plainly what went wrong. Do not retry the tool — it will fail the same way.",
  };
}

// For callers outside the tool loop (image/link perception) that compose their
// own sentence and only need the classification plus a safe reason clause.
function summarizeFailure(err) {
  const code = classifyToolError(err);
  const { retryable, reason } = metaFor(code);
  return { code, retryable, reason };
}

module.exports = {
  CODES,
  classifyToolError,
  summarizeFailure,
  normalizeToolError,
  decorateToolError,
  describeToolFailure,
  isToolError,
  humanizeTool,
};
