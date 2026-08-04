// §5.8 item 4 — per-tool call budgets.
//
// The three shipped guards (tool description, dedup cache, final-slot
// tool_choice=none) all miss the same case: several *genuinely different* queries
// to one retrieval tool. The dedup cache keys on normalised args, so re-phrasings
// are distinct keys, real calls, and the global depth budget is gone.
//
// These drive the real executeToolCall so the interaction with the dedup cache —
// the thing most likely to break — is exercised rather than assumed.

const config = require("../../config.js");

const mockSearchHistory = jest.fn();
const mockGetJackpot = jest.fn();

jest.mock("../../database", () => ({ db: { get: jest.fn(async () => null) } }));
jest.mock("../../utils/logger", () => ({
  log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock("../../utils/messageArchive", () => ({
  searchFTS: (...a) => mockSearchHistory(...a),
  searchSemantic: jest.fn(() => []),
  searchSemanticFull: jest.fn(() => []),
}));
jest.mock("../../utils/jackpot", () => ({
  getJackpot: (...a) => mockGetJackpot(...a),
  MIN_BET: 1000,
  RATE: 0.02,
}));
jest.mock("../../utils/llm", () => ({ generateImage: jest.fn(), embed: jest.fn(async () => ({ embedding: [0.1] })) }));
jest.mock("../../utils/kb", () => ({ search: jest.fn(() => []) }));
jest.mock("../../utils/kb/preflight", () => ({ findRelevant: jest.fn(() => []) }));
jest.mock("../../utils/bank", () => ({ getCurrentTopUsers: jest.fn(), getAllTimeTopUsers: jest.fn() }));
jest.mock("../../utils/ratelimiter", () => ({ canGenerateImage: jest.fn(() => ({ allowed: true })) }));
jest.mock("../../utils/inventory", () => ({
  getDailyShopStock: jest.fn(), nextShopResetEpoch: jest.fn(), formatPrice: jest.fn(),
}));
jest.mock("../../utils/explanations", () => ({}));
jest.mock("../../utils/urlContext", () => ({ fetchPageText: jest.fn() }));
jest.mock("../../utils/jobs", () => ({}));
jest.mock("../../utils/reminders/parse", () => ({ parseWhen: jest.fn() }));
jest.mock("../../utils/gameResults", () => ({}));
jest.mock("../../utils/episodes", () => ({}));
jest.mock("../../utils/kbProposals", () => ({}));

const { executeToolCall, TOOL_BUDGETS } = require("../../utils/openai-tools");
const { CODES, isReportableFailure, isControlSignal } = require("../../utils/toolErrors");

const MESSAGE = { guild: { id: "g1" }, channelId: "c1", author: { id: "u1" } };

function newTurn() {
  return { queryCache: new Map(), toolCounts: new Map(), pendingAttachments: [], pendingToolCalls: [] };
}

function call(name, args, toolCtx) {
  return executeToolCall(
    { function: { name, arguments: JSON.stringify(args) } },
    MESSAGE,
    {},
    toolCtx,
  );
}

beforeEach(() => {
  config.TOOL_BUDGETS_ENABLED = true;
  mockSearchHistory.mockReset();
  mockGetJackpot.mockReset();
  // Distinct results per query so the dedup cache does not collapse them.
  mockSearchHistory.mockImplementation(() => [
    { id: 1, message_id: "m1", author_id: "u2", content: "something", created_at: Date.now(), rank: 1 },
  ]);
  mockGetJackpot.mockResolvedValue({ amount: 5000, lastWinner: null });
});

afterAll(() => { config.TOOL_BUDGETS_ENABLED = true; });

describe("capped tools", () => {
  test("allows exactly the budgeted number of distinct calls", async () => {
    const ctx = newTurn();
    const budget = TOOL_BUDGETS.search_history;

    for (let i = 0; i < budget; i++) {
      const res = await call("search_history", { query: `distinct query ${i}` }, ctx);
      expect(res.error_code).toBeUndefined();
    }
    expect(mockSearchHistory).toHaveBeenCalledTimes(budget);
  });

  test("the call past the cap returns tool_budget_exhausted", async () => {
    const ctx = newTurn();
    const budget = TOOL_BUDGETS.search_history;
    for (let i = 0; i < budget; i++) await call("search_history", { query: `q${i}` }, ctx);

    const res = await call("search_history", { query: "one more angle" }, ctx);
    expect(res.error_code).toBe(CODES.TOOL_BUDGET_EXHAUSTED);
    expect(res.retryable).toBe(false);
    expect(res.tool).toBe("search_history");
  });

  test("the short-circuit never invokes the handler", async () => {
    const ctx = newTurn();
    const budget = TOOL_BUDGETS.search_history;
    for (let i = 0; i < budget; i++) await call("search_history", { query: `q${i}` }, ctx);
    mockSearchHistory.mockClear();

    await call("search_history", { query: "blocked" }, ctx);
    expect(mockSearchHistory).not.toHaveBeenCalled();
  });

  test("the guidance steers sideways and stays out of the user's view", async () => {
    const ctx = newTurn();
    const budget = TOOL_BUDGETS.search_history;
    for (let i = 0; i < budget; i++) await call("search_history", { query: `q${i}` }, ctx);

    const res = await call("search_history", { query: "blocked" }, ctx);
    expect(res.guidance).toMatch(/different tool|already have/i);
    expect(res.guidance).toMatch(/not mention this limit/i);
  });
});

describe("uncapped tools", () => {
  test("a cheap deterministic lookup is never budget-blocked", async () => {
    const ctx = newTurn();
    // Well past any per-tool cap — these are exactly the calls the model should
    // feel free to make.
    for (let i = 0; i < 6; i++) {
      const res = await call("get_jackpot", { nonce: i }, ctx);
      expect(res.error_code).not.toBe(CODES.TOOL_BUDGET_EXHAUSTED);
    }
  });

  test("only retrieval tools appear in the budget table", () => {
    expect(Object.keys(TOOL_BUDGETS).sort()).toEqual(
      ["lookup_kb", "recall_episode", "search_history", "web_search"],
    );
  });
});

describe("interaction with the dedup cache", () => {
  test("cache hits do not consume budget", async () => {
    const ctx = newTurn();
    const budget = TOOL_BUDGETS.search_history;

    // One real call, then many duplicates of it.
    await call("search_history", { query: "the jackpot" }, ctx);
    for (let i = 0; i < 5; i++) await call("search_history", { query: "the jackpot" }, ctx);

    // Only the first consumed budget, so the remaining allowance is intact.
    expect(ctx.toolCounts.get("search_history")).toBe(1);
    for (let i = 1; i < budget; i++) {
      const res = await call("search_history", { query: `fresh angle ${i}` }, ctx);
      expect(res.error_code).toBeUndefined();
    }
  });

  test("a duplicate is still served after the budget is spent", async () => {
    const ctx = newTurn();
    const budget = TOOL_BUDGETS.search_history;
    for (let i = 0; i < budget; i++) await call("search_history", { query: `q${i}` }, ctx);

    // Cached results cost nothing, so refusing them would be pure loss.
    const res = await call("search_history", { query: "q0" }, ctx);
    expect(res.error_code).toBeUndefined();
    expect(res.note).toMatch(/duplicate query/i);
  });
});

describe("scoping", () => {
  test("budgets are per tool", async () => {
    const ctx = newTurn();
    for (let i = 0; i < TOOL_BUDGETS.search_history; i++) {
      await call("search_history", { query: `q${i}` }, ctx);
    }
    expect((await call("search_history", { query: "blocked" }, ctx)).error_code)
      .toBe(CODES.TOOL_BUDGET_EXHAUSTED);

    // lookup_kb has its own untouched allowance.
    const kb = await call("lookup_kb", { query: "server rules" }, ctx);
    expect(kb.error_code).not.toBe(CODES.TOOL_BUDGET_EXHAUSTED);
  });

  test("budgets are per turn — a fresh context starts clean", async () => {
    const first = newTurn();
    for (let i = 0; i < TOOL_BUDGETS.search_history; i++) {
      await call("search_history", { query: `q${i}` }, first);
    }
    expect((await call("search_history", { query: "blocked" }, first)).error_code)
      .toBe(CODES.TOOL_BUDGET_EXHAUSTED);

    const second = newTurn();
    const res = await call("search_history", { query: "new turn" }, second);
    expect(res.error_code).toBeUndefined();
  });
});

describe("classification", () => {
  test("exhaustion is a control signal, not a reportable failure", async () => {
    const ctx = newTurn();
    for (let i = 0; i < TOOL_BUDGETS.search_history; i++) {
      await call("search_history", { query: `q${i}` }, ctx);
    }
    const res = await call("search_history", { query: "blocked" }, ctx);

    // A turn that hit a cap and then answered fine must not trigger the
    // user-facing failure explanation.
    expect(isControlSignal(res)).toBe(true);
    expect(isReportableFailure(res)).toBe(false);
  });

  test("invalid_arguments is also a control signal", () => {
    expect(isControlSignal({ error: "invalid_arguments", error_code: CODES.INVALID_INPUT })).toBe(true);
    expect(isReportableFailure({ error: "invalid_arguments", error_code: CODES.INVALID_INPUT })).toBe(false);
  });

  test("a real failure remains reportable", () => {
    expect(isReportableFailure({ error: "The web search failed.", error_code: CODES.TIMEOUT })).toBe(true);
  });
});

describe("master switch", () => {
  test("disabled restores purely global depth limiting", async () => {
    config.TOOL_BUDGETS_ENABLED = false;
    const ctx = newTurn();
    for (let i = 0; i < TOOL_BUDGETS.search_history + 3; i++) {
      const res = await call("search_history", { query: `q${i}` }, ctx);
      expect(res.error_code).not.toBe(CODES.TOOL_BUDGET_EXHAUSTED);
    }
  });
});
