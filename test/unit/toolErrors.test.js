const {
  CODES,
  classifyToolError,
  summarizeFailure,
  normalizeToolError,
  decorateToolError,
  describeToolFailure,
  isToolError,
  isControlSignal,
  isReportableFailure,
  humanizeTool,
} = require("../../utils/toolErrors");

describe("classifyToolError", () => {
  test.each([
    [429, CODES.RATE_LIMITED],
    [402, CODES.QUOTA_EXCEEDED],
    [401, CODES.AUTH],
    [403, CODES.AUTH],
    [404, CODES.NOT_FOUND],
    [408, CODES.TIMEOUT],
    [504, CODES.TIMEOUT],
    [502, CODES.UPSTREAM_UNAVAILABLE],
    [503, CODES.UPSTREAM_UNAVAILABLE],
    [500, CODES.UPSTREAM_ERROR],
    [400, CODES.INVALID_INPUT],
  ])("HTTP %i classifies as %s", (status, expected) => {
    expect(classifyToolError({ status })).toBe(expected);
    expect(classifyToolError({ response: { status } })).toBe(expected);
  });

  test.each([
    ["ECONNRESET", CODES.NETWORK],
    ["ECONNREFUSED", CODES.NETWORK],
    ["ENOTFOUND", CODES.NETWORK],
    ["ETIMEDOUT", CODES.TIMEOUT],
  ])("node error code %s classifies as %s", (code, expected) => {
    expect(classifyToolError({ code })).toBe(expected);
  });

  test("a status wins over conflicting message text", () => {
    expect(classifyToolError({ status: 429, message: "not found" })).toBe(CODES.RATE_LIMITED);
  });

  test.each([
    ["Rate limit exceeded, try again later", CODES.RATE_LIMITED],
    ["You have exceeded your quota", CODES.QUOTA_EXCEEDED],
    ["Payment required for this model", CODES.QUOTA_EXCEEDED],
    ["Request timed out", CODES.TIMEOUT],
    ["fetch failed", CODES.NETWORK],
    ["socket hang up", CODES.NETWORK],
    ["CF_API_KEY is not set.", CODES.NOT_CONFIGURED],
    ["Invalid API key provided", CODES.AUTH],
    ["Service Unavailable", CODES.UPSTREAM_UNAVAILABLE],
    ["Missing required 'prompt' argument.", CODES.INVALID_INPUT],
    ["User \"bob\" not found in this server.", CODES.NOT_FOUND],
    ["No matching knowledge base entries found.", CODES.EMPTY_RESULT],
    ["Image generation is only available in chatbot channels: #bot", CODES.NOT_PERMITTED],
  ])("message %p classifies as %s", (text, expected) => {
    expect(classifyToolError(text)).toBe(expected);
    expect(classifyToolError(new Error(text))).toBe(expected);
  });

  test("quota is preferred over rate limit when both words appear", () => {
    expect(classifyToolError("quota exceeded: too many requests")).toBe(CODES.QUOTA_EXCEEDED);
  });

  test("unrecognized and empty input degrade to unknown", () => {
    expect(classifyToolError("something bizarre happened")).toBe(CODES.UNKNOWN);
    expect(classifyToolError(new Error(""))).toBe(CODES.UNKNOWN);
    expect(classifyToolError(null)).toBe(CODES.UNKNOWN);
    expect(classifyToolError(undefined)).toBe(CODES.UNKNOWN);
  });

  test("real Cloudflare failure text does not classify as unknown", () => {
    const raw = 'Cloudflare image generation failed: {"errors":[{"code":10000,"message":"Authentication error"}]}';
    expect(classifyToolError(raw)).toBe(CODES.AUTH);
  });

  // A daily free-tier exhaustion arrives as a 429, but retrying cannot fix it —
  // reading it as a plain rate limit would promise a retry that never works.
  test("Gemini quota exhaustion reads as quota, not rate limit, despite the 429", () => {
    const err = new Error(
      '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.' +
      ' Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20",' +
      '"status":"RESOURCE_EXHAUSTED"}}'
    );
    err.status = "RESOURCE_EXHAUSTED";
    expect(classifyToolError(err)).toBe(CODES.QUOTA_EXCEEDED);
    expect(summarizeFailure(err).retryable).toBe(false);
  });

  test("a plain 429 with no quota wording stays a retryable rate limit", () => {
    expect(classifyToolError({ status: 429, message: "Too many requests" })).toBe(CODES.RATE_LIMITED);
    expect(summarizeFailure({ status: 429, message: "Too many requests" }).retryable).toBe(true);
  });

  test("a top-level status is read, not just a nested one", () => {
    expect(classifyToolError({ status: 503 })).toBe(CODES.UPSTREAM_UNAVAILABLE);
    expect(classifyToolError({ statusCode: 404 })).toBe(CODES.NOT_FOUND);
  });
});

describe("summarizeFailure", () => {
  test("returns a code, a retry flag, and a reason clause with no raw detail", () => {
    const result = summarizeFailure(new Error("You exceeded your current quota for gemini-2.5-flash"));
    expect(result.code).toBe(CODES.QUOTA_EXCEEDED);
    expect(result.retryable).toBe(false);
    expect(result.reason).not.toMatch(/gemini|quota exceeded for|429/i);
  });
});

describe("normalizeToolError", () => {
  test("produces a user-safe error, a code, and retry guidance", () => {
    const result = normalizeToolError("generate_image", { status: 429 });
    expect(result.error_code).toBe(CODES.RATE_LIMITED);
    expect(result.tool).toBe("generate_image");
    expect(result.retryable).toBe(true);
    expect(result.error).toBe("The image request failed because that service is rate-limited at the moment.");
    expect(result.guidance).toMatch(/try again shortly/i);
  });

  test("keeps `error` a truthy string so existing checks still work", () => {
    const result = normalizeToolError("lookup_kb", new Error("boom"));
    expect(typeof result.error).toBe("string");
    expect(isToolError(result)).toBe(true);
  });

  test("never leaks raw exception text", () => {
    const raw = 'Cloudflare image generation failed: {"errors":[{"code":5006}]}';
    const result = normalizeToolError("generate_image", new Error(raw));
    expect(result.error).not.toContain("Cloudflare");
    expect(result.error).not.toContain("5006");
  });

  test("a forced code overrides classification", () => {
    const result = normalizeToolError("generate_image", new Error("not found"), { code: CODES.RATE_LIMITED });
    expect(result.error_code).toBe(CODES.RATE_LIMITED);
  });

  test("non-retryable codes tell the model not to retry", () => {
    const result = normalizeToolError("lookup_kb", { status: 403 });
    expect(result.retryable).toBe(false);
    expect(result.guidance).toMatch(/will fail the same way/i);
  });
});

describe("decorateToolError", () => {
  test("preserves a handler's own wording and only adds metadata", () => {
    const decorated = decorateToolError("generate_image", { error: "Only available in #bot-spam." });
    expect(decorated.error).toBe("Only available in #bot-spam.");
    expect(decorated.error_code).toBe(CODES.NOT_PERMITTED);
    expect(decorated.retryable).toBe(false);
  });

  test("leaves successful results untouched", () => {
    const ok = { success: true, message: "done" };
    expect(decorateToolError("generate_image", ok)).toBe(ok);
    expect(decorateToolError("lookup_kb", { results: [] })).toEqual({ results: [] });
  });

  test("does not re-classify an already-normalized error", () => {
    const already = normalizeToolError("web_search", { status: 429 });
    expect(decorateToolError("web_search", already)).toBe(already);
  });

  test("tolerates null and non-object results", () => {
    expect(decorateToolError("lookup_kb", null)).toBe(null);
    expect(decorateToolError("lookup_kb", undefined)).toBe(undefined);
  });
});

describe("describeToolFailure", () => {
  test("reads as a complete sentence naming the tool", () => {
    expect(describeToolFailure(CODES.RATE_LIMITED, "generate_image"))
      .toBe("I couldn't finish that image request — that service is rate-limited at the moment. Give it another shot in a moment.");
  });

  test("omits the retry nudge for permanent failures", () => {
    const text = describeToolFailure(CODES.AUTH, "web_search");
    expect(text).not.toMatch(/another shot/i);
  });

  test("handles an unknown code and a missing tool name", () => {
    expect(describeToolFailure("bogus_code", "web_search")).toContain("something went wrong");
    expect(describeToolFailure(CODES.TIMEOUT, undefined)).toContain("I couldn't finish that");
  });

  test("never contains raw technical detail", () => {
    for (const code of Object.values(CODES)) {
      const text = describeToolFailure(code, "generate_image");
      expect(text).not.toMatch(/\b(HTTP|[45]\d\d|cloudflare|deepseek|brave|gemini)\b/i);
    }
  });
});

describe("isToolError", () => {
  test.each([
    [{ error: "nope" }, true],
    [{ success: true }, false],
    [{ error: "" }, false],
    [null, false],
    ["error", false],
  ])("%p → %p", (input, expected) => {
    expect(isToolError(input)).toBe(expected);
  });
});

describe("humanizeTool", () => {
  test("maps known tools to a readable noun and falls back otherwise", () => {
    expect(humanizeTool("generate_image")).toBe("image request");
    expect(humanizeTool("some_future_tool")).toBe("lookup");
  });
});

describe("tool_budget_exhausted", () => {
  test("is non-retryable — retrying is exactly what it exists to stop", () => {
    const out = normalizeToolError("search_history", null, { code: CODES.TOOL_BUDGET_EXHAUSTED });
    expect(out.retryable).toBe(false);
    expect(out.guidance).toMatch(/do not retry/i);
  });

  test("is never inferred from free text — it is only ever set explicitly", () => {
    expect(classifyToolError("tool budget exhausted")).not.toBe(CODES.TOOL_BUDGET_EXHAUSTED);
    expect(classifyToolError(new Error("budget"))).not.toBe(CODES.TOOL_BUDGET_EXHAUSTED);
  });

  test("has a user-safe reason, in case it ever does surface", () => {
    const sentence = describeToolFailure(CODES.TOOL_BUDGET_EXHAUSTED, "search_history");
    expect(sentence).not.toMatch(/budget|tool_|error_code/i);
    expect(sentence.endsWith(".")).toBe(true);
  });
});

describe("control signals vs reportable failures", () => {
  test("budget exhaustion is a control signal", () => {
    const result = { error: "used up", error_code: CODES.TOOL_BUDGET_EXHAUSTED };
    expect(isControlSignal(result)).toBe(true);
    expect(isReportableFailure(result)).toBe(false);
  });

  test("the invalid_arguments sentinel is a control signal", () => {
    const result = { error: "invalid_arguments", error_code: CODES.INVALID_INPUT };
    expect(isControlSignal(result)).toBe(true);
    expect(isReportableFailure(result)).toBe(false);
  });

  test("a real invalid-input failure is still reportable", () => {
    // Same code, but a genuine handler failure rather than the bare sentinel.
    const result = { error: "The image request failed because the request was missing something it needed.", error_code: CODES.INVALID_INPUT };
    expect(isControlSignal(result)).toBe(false);
    expect(isReportableFailure(result)).toBe(true);
  });

  test.each([CODES.TIMEOUT, CODES.NETWORK, CODES.QUOTA_EXCEEDED, CODES.UPSTREAM_ERROR])(
    "%s stays reportable",
    (code) => {
      expect(isReportableFailure({ error: "boom", error_code: code })).toBe(true);
    },
  );

  test("a success is neither", () => {
    expect(isControlSignal({ results: [] })).toBe(false);
    expect(isReportableFailure({ results: [] })).toBe(false);
  });
});
