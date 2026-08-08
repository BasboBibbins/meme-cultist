// Provider health ring.
//
// The thresholds matter less than the sample floor: a restart during a blip must
// not mark every provider degraded at once, because the embedding circuit
// breaker acts on this.

const config = require("../../config.js");

jest.mock("../../utils/logger", () => ({
  log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const health = require("../../utils/llm/health");

const ORIGINAL = {
  enabled: config.PROVIDER_HEALTH_ENABLED,
  ring: config.PROVIDER_HEALTH_RING_SIZE,
  minSamples: config.PROVIDER_HEALTH_MIN_SAMPLES,
  errorRate: config.PROVIDER_DEGRADED_ERROR_RATE,
  p95: config.PROVIDER_DEGRADED_P95_MS,
};

function fill(provider, n, { ok = true, latency_ms = 100 } = {}) {
  for (let i = 0; i < n; i++) health.record(provider, { ok, latency_ms });
}

beforeEach(() => {
  health.reset();
  config.PROVIDER_HEALTH_ENABLED = ORIGINAL.enabled;
  config.PROVIDER_HEALTH_RING_SIZE = ORIGINAL.ring;
  config.PROVIDER_HEALTH_MIN_SAMPLES = ORIGINAL.minSamples;
  config.PROVIDER_DEGRADED_ERROR_RATE = ORIGINAL.errorRate;
  config.PROVIDER_DEGRADED_P95_MS = ORIGINAL.p95;
});

afterAll(() => {
  Object.assign(config, {
    PROVIDER_HEALTH_ENABLED: ORIGINAL.enabled,
    PROVIDER_HEALTH_RING_SIZE: ORIGINAL.ring,
    PROVIDER_HEALTH_MIN_SAMPLES: ORIGINAL.minSamples,
    PROVIDER_DEGRADED_ERROR_RATE: ORIGINAL.errorRate,
    PROVIDER_DEGRADED_P95_MS: ORIGINAL.p95,
  });
});

describe("ring buffer", () => {
  test("an untouched provider reports healthy with zero calls", () => {
    const snap = health.snapshot("deepseek");
    expect(snap.calls).toBe(0);
    expect(snap.degraded).toBe(false);
    expect(snap.successRate).toBe(1);
  });

  test("retains only the newest N samples", () => {
    config.PROVIDER_HEALTH_RING_SIZE = 5;
    health.reset();
    fill("deepseek", 12);
    expect(health.snapshot("deepseek").calls).toBe(5);
  });

  test("wrapping discards the oldest outcomes", () => {
    config.PROVIDER_HEALTH_RING_SIZE = 4;
    config.PROVIDER_HEALTH_MIN_SAMPLES = 4;
    health.reset();
    fill("cloudflare", 4, { ok: false });   // ring is all failures
    fill("cloudflare", 4, { ok: true });    // ...then fully overwritten
    const snap = health.snapshot("cloudflare");
    expect(snap.successRate).toBe(1);
    expect(snap.degraded).toBe(false);
  });

  test("computes success rate and percentiles over the live window", () => {
    fill("deepseek", 8, { ok: true, latency_ms: 100 });
    fill("deepseek", 2, { ok: false, latency_ms: 5000 });
    const snap = health.snapshot("deepseek");
    expect(snap.calls).toBe(10);
    expect(snap.successRate).toBeCloseTo(0.8);
    expect(snap.p50).toBe(100);
    expect(snap.p95).toBe(5000);
  });
});

describe("degradation thresholds", () => {
  test("below the sample floor, never degraded — even at a 100% failure rate", () => {
    config.PROVIDER_HEALTH_MIN_SAMPLES = 10;
    fill("cloudflare", 9, { ok: false });
    expect(health.isDegraded("cloudflare")).toBe(false);
  });

  test("degrades on error rate once the floor is met", () => {
    config.PROVIDER_HEALTH_MIN_SAMPLES = 10;
    fill("cloudflare", 5, { ok: true });
    fill("cloudflare", 5, { ok: false });
    expect(health.isDegraded("cloudflare")).toBe(true);
  });

  test("degrades on latency independently of error rate", () => {
    config.PROVIDER_HEALTH_MIN_SAMPLES = 10;
    config.PROVIDER_DEGRADED_P95_MS = 1000;
    fill("gemini", 10, { ok: true, latency_ms: 9000 });
    const snap = health.snapshot("gemini");
    expect(snap.successRate).toBe(1);
    expect(snap.degraded).toBe(true);
  });

  test("a healthy provider stays healthy", () => {
    fill("deepseek", 30, { ok: true, latency_ms: 200 });
    expect(health.isDegraded("deepseek")).toBe(false);
  });
});

describe("provider isolation", () => {
  test("one provider failing does not degrade another", () => {
    config.PROVIDER_HEALTH_MIN_SAMPLES = 10;
    fill("cloudflare", 20, { ok: false });
    fill("deepseek", 20, { ok: true });
    expect(health.isDegraded("cloudflare")).toBe(true);
    expect(health.isDegraded("deepseek")).toBe(false);
  });

  test("snapshotAll reports every known provider", () => {
    const all = health.snapshotAll();
    expect(Object.keys(all).sort()).toEqual(["cloudflare", "deepseek", "gemini"]);
  });
});

describe("error and recency tracking", () => {
  test("records the classification of the last failure", () => {
    health.record("cloudflare", { ok: false, latency_ms: 30000, code: "timeout" });
    expect(health.snapshot("cloudflare").lastError.code).toBe("timeout");
  });

  test("tracks the last success for the probe's skip check", () => {
    expect(health.msSinceLastCall("deepseek")).toBe(Infinity);
    health.record("deepseek", { ok: true, latency_ms: 50 });
    expect(health.msSinceLastCall("deepseek")).toBeLessThan(1000);
  });

  test("a failure also counts as recent activity", () => {
    health.record("cloudflare", { ok: false, latency_ms: 10, code: "network" });
    expect(health.msSinceLastCall("cloudflare")).toBeLessThan(1000);
  });
});

describe("master switch", () => {
  test("disabled makes record a no-op and isDegraded always false", () => {
    config.PROVIDER_HEALTH_ENABLED = false;
    fill("cloudflare", 50, { ok: false });
    expect(health.isDegraded("cloudflare")).toBe(false);
    expect(health.snapshot("cloudflare").calls).toBe(0);
  });

  test("reset clears every provider", () => {
    fill("deepseek", 5);
    fill("cloudflare", 5);
    health.reset();
    expect(health.snapshot("deepseek").calls).toBe(0);
    expect(health.snapshot("cloudflare").calls).toBe(0);
  });
});
