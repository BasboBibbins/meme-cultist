// Integration of the provider health ring and the embedding circuit breaker at
// the one call site that wires both: router.embed().
//
// The unit tests for health and breaker cover their logic in isolation; these
// cover the wiring, which is where the subtle mistakes live — recording a cache
// hit as a real success, or checking the breaker before the cache.

const config = require("../../config.js");

const mockEmbedText = jest.fn();
const mockCacheGet = jest.fn();
const mockCacheSet = jest.fn();

jest.mock("../../utils/logger", () => ({
  log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock("../../utils/llm/adapters/cloudflare", () => ({
  embedText: (...a) => mockEmbedText(...a),
  generateImage: jest.fn(),
}));
jest.mock("../../utils/llm/adapters/deepseek", () => ({ chat: jest.fn(), chatStream: jest.fn() }));
jest.mock("../../utils/llm/adapters/gemini", () => ({ describeImage: jest.fn() }));
jest.mock("../../utils/llm/embedCache", () => ({
  get: (...a) => mockCacheGet(...a),
  set: (...a) => mockCacheSet(...a),
  close: jest.fn(),
}));

const router = require("../../utils/llm/router");
const health = require("../../utils/llm/health");

const EMBEDDING = [0.1, 0.2];

beforeEach(() => {
  mockEmbedText.mockReset();
  mockCacheGet.mockReset();
  mockCacheSet.mockReset();
  mockCacheGet.mockReturnValue(null);
  health.reset();
  router.resetBreaker();
  config.PROVIDER_HEALTH_ENABLED = true;
  config.PROVIDER_HEALTH_MIN_SAMPLES = 10;
  config.EMBED_BREAKER_ENABLED = true;
});

describe("cache interaction", () => {
  test("a cache hit never reaches the network or the health ring", async () => {
    mockCacheGet.mockReturnValue(EMBEDDING);

    const res = await router.embed({ text: "hello" });

    expect(res.embedding).toBe(EMBEDDING);
    expect(mockEmbedText).not.toHaveBeenCalled();
    // Recording cache hits as 0 ms successes would flood the ring with fake wins
    // and mask a completely dead endpoint.
    expect(health.snapshot("cloudflare").calls).toBe(0);
  });

  test("a cache hit is served even while the breaker is open", async () => {
    // Open the breaker first.
    for (let i = 0; i < 20; i++) health.record("cloudflare", { ok: false, latency_ms: 10, code: "timeout" });
    mockEmbedText.mockRejectedValue(new Error("service unavailable"));
    await expect(router.embed({ text: "cold", retries: 0 })).rejects.toThrow();
    mockEmbedText.mockClear();

    mockCacheGet.mockReturnValue(EMBEDDING);
    const res = await router.embed({ text: "warm" });

    expect(res.embedding).toBe(EMBEDDING);
    expect(mockEmbedText).not.toHaveBeenCalled();
  });

  test("noCache bypasses the cache in both directions", async () => {
    mockCacheGet.mockReturnValue(EMBEDDING);
    mockEmbedText.mockResolvedValue({ embedding: [9, 9] });

    const res = await router.embed({ text: "probe", noCache: true, retries: 0 });

    // Without this the probe is answered from cache after its first run and
    // stops measuring anything at all.
    expect(mockEmbedText).toHaveBeenCalled();
    expect(res.embedding).toEqual([9, 9]);
    expect(mockCacheSet).not.toHaveBeenCalled();
  });
});

describe("health recording", () => {
  test("a real success is recorded once, not once per retry", async () => {
    mockEmbedText.mockResolvedValue({ embedding: EMBEDDING });
    await router.embed({ text: "a", retries: 0 });
    expect(health.snapshot("cloudflare").calls).toBe(1);
  });

  test("a failure is recorded with its classification", async () => {
    mockEmbedText.mockRejectedValue(new Error("embed timed out (30000ms)"));
    await expect(router.embed({ text: "a", retries: 0 })).rejects.toThrow();
    const snap = health.snapshot("cloudflare");
    expect(snap.calls).toBe(1);
    expect(snap.successRate).toBe(0);
    expect(snap.lastError.code).toBe("timeout");
  });

  test("an exhausted retry ladder still counts as one logical call", async () => {
    mockEmbedText.mockRejectedValue(Object.assign(new Error("boom"), { status: 503 }));
    await expect(router.embed({ text: "a", retries: 2, baseDelay: 1 })).rejects.toThrow();
    expect(health.snapshot("cloudflare").calls).toBe(1);
  });
});

describe("breaker short-circuit", () => {
  async function openTheBreaker() {
    for (let i = 0; i < 20; i++) health.record("cloudflare", { ok: false, latency_ms: 10, code: "timeout" });
    mockEmbedText.mockRejectedValue(new Error("service unavailable"));
    await expect(router.embed({ text: "trigger", retries: 0 })).rejects.toThrow();
  }

  test("an open breaker throws without calling the adapter", async () => {
    await openTheBreaker();
    mockEmbedText.mockClear();

    await expect(router.embed({ text: "next", retries: 0 })).rejects.toThrow(/circuit breaker is open/);
    expect(mockEmbedText).not.toHaveBeenCalled();
  });

  test("the short-circuit error carries the breaker flag the job queue defers on", async () => {
    await openTheBreaker();
    await expect(router.embed({ text: "next", retries: 0 })).rejects.toMatchObject({ breakerOpen: true });
  });

  test("disabling the breaker restores pre-breaker behaviour", async () => {
    config.EMBED_BREAKER_ENABLED = false;
    for (let i = 0; i < 20; i++) health.record("cloudflare", { ok: false, latency_ms: 10, code: "timeout" });
    mockEmbedText.mockRejectedValue(new Error("service unavailable"));

    await expect(router.embed({ text: "a", retries: 0 })).rejects.toThrow(/service unavailable/);
    mockEmbedText.mockClear();
    // Still attempts the call rather than short-circuiting.
    await expect(router.embed({ text: "b", retries: 0 })).rejects.toThrow(/service unavailable/);
    expect(mockEmbedText).toHaveBeenCalled();
  });
});
