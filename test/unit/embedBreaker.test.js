// Embedding circuit breaker.
//
// The breaker does not keep its own opinion about liveness — it defers to the
// health ring for that. What it owns is the state machine: when to stop calling,
// when to try again, and how to make sure exactly one caller does the trying.

const config = require("../../config.js");

jest.mock("../../utils/logger", () => ({
  log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const health = require("../../utils/llm/health");
const { createBreaker, breakerOpenError, STATES } = require("../../utils/llm/breaker");
const { CODES } = require("../../utils/toolErrors");

let cooldownMs = 1000;
let enabled = true;

function makeBreaker() {
  return createBreaker({
    name: "test",
    provider: "cloudflare",
    cooldownMs: () => cooldownMs,
    enabled: () => enabled,
  });
}

// Drives the ring past its sample floor so isDegraded('cloudflare') is true —
// the breaker only opens when the ring says the provider is degraded.
function degradeProvider() {
  health.reset();
  for (let i = 0; i < 20; i++) health.record("cloudflare", { ok: false, latency_ms: 50, code: "timeout" });
}

function healthyProvider() {
  health.reset();
  for (let i = 0; i < 20; i++) health.record("cloudflare", { ok: true, latency_ms: 50 });
}

beforeEach(() => {
  cooldownMs = 1000;
  enabled = true;
  config.PROVIDER_HEALTH_ENABLED = true;
  config.PROVIDER_HEALTH_MIN_SAMPLES = 10;
  health.reset();
});

describe("opening", () => {
  test("starts closed and lets calls through", () => {
    const b = makeBreaker();
    expect(b.currentState()).toBe(STATES.CLOSED);
    expect(b.shouldShortCircuit()).toBe(false);
  });

  test("opens once the health ring reports the provider degraded", () => {
    const b = makeBreaker();
    degradeProvider();
    b.recordFailure(new Error("embed timed out"));
    expect(b.currentState()).toBe(STATES.OPEN);
    expect(b.shouldShortCircuit()).toBe(true);
  });

  test("stays closed while the provider is still healthy", () => {
    const b = makeBreaker();
    healthyProvider();
    b.recordFailure(new Error("one-off blip"));
    expect(b.currentState()).toBe(STATES.CLOSED);
  });

  test("stays closed below the ring's sample floor, however bad the failures", () => {
    const b = makeBreaker();
    health.reset();
    for (let i = 0; i < 5; i++) {
      health.record("cloudflare", { ok: false, latency_ms: 10, code: "network" });
      b.recordFailure(new Error("network error"));
    }
    expect(b.currentState()).toBe(STATES.CLOSED);
  });
});

describe("non-tripping failure codes", () => {
  test.each([
    ["invalid API key", CODES.AUTH],
    ["missing required argument", CODES.INVALID_INPUT],
    ["CF_API_KEY is not set", CODES.NOT_CONFIGURED],
  ])("%s does not open the breaker even when degraded", (message) => {
    const b = makeBreaker();
    degradeProvider();
    b.recordFailure(new Error(message));
    // A bad key or a malformed request is not a capacity problem, and opening
    // would hide the misconfiguration behind an apparent self-heal.
    expect(b.currentState()).toBe(STATES.CLOSED);
  });

  test("a genuine capacity failure still opens", () => {
    const b = makeBreaker();
    degradeProvider();
    b.recordFailure(new Error("service unavailable"));
    expect(b.currentState()).toBe(STATES.OPEN);
  });
});

describe("short-circuiting", () => {
  test("an open breaker never invokes the call", async () => {
    const b = makeBreaker();
    degradeProvider();
    b.recordFailure(new Error("timed out"));

    const call = jest.fn();
    if (!b.shouldShortCircuit()) call();
    expect(call).not.toHaveBeenCalled();
  });

  test("the thrown error classifies as upstream_unavailable", () => {
    const err = breakerOpenError("embed");
    expect(err.breakerOpen).toBe(true);
    expect(err.error_code).toBe(CODES.UPSTREAM_UNAVAILABLE);
  });
});

describe("half-open recovery", () => {
  function openBreaker() {
    const b = makeBreaker();
    degradeProvider();
    b.recordFailure(new Error("timed out"));
    return b;
  }

  test("transitions to half-open once the cooldown elapses", async () => {
    cooldownMs = 20;
    const b = openBreaker();
    expect(b.currentState()).toBe(STATES.OPEN);
    await new Promise(r => setTimeout(r, 30));
    expect(b.currentState()).toBe(STATES.HALF_OPEN);
  });

  test("a successful trial call closes the breaker", async () => {
    cooldownMs = 20;
    const b = openBreaker();
    await new Promise(r => setTimeout(r, 30));
    expect(b.shouldShortCircuit()).toBe(false); // the one trial call
    b.recordSuccess();
    expect(b.currentState()).toBe(STATES.CLOSED);
  });

  test("a failed trial call re-opens with a fresh cooldown", async () => {
    cooldownMs = 20;
    const b = openBreaker();
    await new Promise(r => setTimeout(r, 30));
    b.shouldShortCircuit();
    b.recordFailure(new Error("still down"));
    expect(b.currentState()).toBe(STATES.OPEN);
    // Immediately after re-opening the cooldown has not elapsed again.
    expect(b.shouldShortCircuit()).toBe(true);
  });

  test("exactly one caller passes while half-open", async () => {
    cooldownMs = 20;
    const b = openBreaker();
    await new Promise(r => setTimeout(r, 30));
    // The queue tick and an interactive tool call can race here.
    const passed = [b.shouldShortCircuit(), b.shouldShortCircuit(), b.shouldShortCircuit()]
      .filter(shortCircuited => shortCircuited === false);
    expect(passed).toHaveLength(1);
  });

  test("closing fires the onClose hook so deferred work is released", async () => {
    cooldownMs = 20;
    const b = openBreaker();
    const onClose = jest.fn();
    b.setOnClose(onClose);
    await new Promise(r => setTimeout(r, 30));
    b.shouldShortCircuit();
    b.recordSuccess();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("a throwing onClose hook cannot break recovery", async () => {
    cooldownMs = 20;
    const b = openBreaker();
    b.setOnClose(() => { throw new Error("queue unavailable"); });
    await new Promise(r => setTimeout(r, 30));
    b.shouldShortCircuit();
    expect(() => b.recordSuccess()).not.toThrow();
    expect(b.currentState()).toBe(STATES.CLOSED);
  });
});

describe("master switch", () => {
  test("disabled pins the breaker closed", () => {
    enabled = false;
    const b = makeBreaker();
    degradeProvider();
    b.recordFailure(new Error("timed out"));
    expect(b.currentState()).toBe(STATES.CLOSED);
    expect(b.shouldShortCircuit()).toBe(false);
  });

  test("reset returns it to a cold closed state", () => {
    const b = makeBreaker();
    degradeProvider();
    b.recordFailure(new Error("timed out"));
    b.reset();
    expect(b.currentState()).toBe(STATES.CLOSED);
    expect(b.snapshot().trips).toBe(0);
  });
});

describe("snapshot", () => {
  test("reports state and trip count for the admin view", () => {
    const b = makeBreaker();
    degradeProvider();
    b.recordFailure(new Error("timed out"));
    const snap = b.snapshot();
    expect(snap.state).toBe(STATES.OPEN);
    expect(snap.trips).toBe(1);
    expect(snap.openedAt).toEqual(expect.any(Number));
  });
});
