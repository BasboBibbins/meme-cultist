// §7.7 prerequisite: lookup_kb degrades to lexical matching when the embedding
// endpoint is unavailable.
//
// The KB store is cosine-similarity only — unlike search_history and
// recall_episode it has no FTS index — so before this fallback existed a dead
// embedding endpoint failed the lookup outright. The circuit breaker plan
// assumes every retrieval path can serve without embeddings; these tests pin
// that assumption for the one path where it was not true.

const mockEmbed = jest.fn();
const mockKbSearch = jest.fn();
const mockFindRelevant = jest.fn();

jest.mock("../../database", () => ({ db: { get: jest.fn(async () => null) } }));
jest.mock("../../utils/logger", () => ({
  log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock("../../utils/llm", () => ({ generateImage: jest.fn(), embed: (...a) => mockEmbed(...a) }));
jest.mock("../../utils/kb", () => ({ search: (...a) => mockKbSearch(...a) }));
jest.mock("../../utils/kb/preflight", () => ({ findRelevant: (...a) => mockFindRelevant(...a) }));

jest.mock("../../utils/bank", () => ({ getCurrentTopUsers: jest.fn(), getAllTimeTopUsers: jest.fn() }));
jest.mock("../../utils/ratelimiter", () => ({ canGenerateImage: jest.fn(() => ({ allowed: true })) }));
jest.mock("../../utils/messageArchive", () => ({}));
jest.mock("../../utils/jackpot", () => ({ getJackpot: jest.fn(), MIN_BET: 1000, RATE: 0.02 }));
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

const { executeToolCall } = require("../../utils/openai-tools");

const GUILD_ID = "guild-1";

function callLookupKb(query = "how do dailies work") {
  return executeToolCall(
    { function: { name: "lookup_kb", arguments: JSON.stringify({ query }) } },
    { guild: { id: GUILD_ID }, channelId: "c1", author: { id: "u1" } },
    {},
    null,
  );
}

beforeEach(() => {
  mockEmbed.mockReset();
  mockKbSearch.mockReset();
  mockFindRelevant.mockReset();
});

describe("lookup_kb — embedding endpoint healthy", () => {
  test("uses semantic search and does not touch the lexical matcher", async () => {
    mockEmbed.mockResolvedValue({ embedding: [0.1, 0.2] });
    mockKbSearch.mockReturnValue([
      { slug: "daily-weekly", title: "Dailies", content: "Claim koku daily." },
    ]);

    const result = await callLookupKb();

    expect(result.results).toHaveLength(1);
    expect(result.results[0].slug).toBe("daily-weekly");
    expect(mockFindRelevant).not.toHaveBeenCalled();
    // No approximation note when the ranking is genuinely semantic.
    expect(result.note).toBeUndefined();
  });
});

describe("lookup_kb — embedding endpoint down", () => {
  beforeEach(() => {
    mockEmbed.mockRejectedValue(new Error("embed timed out (30000ms)"));
  });

  test("serves lexical results instead of failing the lookup", async () => {
    mockFindRelevant.mockReturnValue([
      { slug: "daily-weekly", title: "Dailies", content: "Claim koku daily.", score: 0.4 },
    ]);

    const result = await callLookupKb();

    expect(result.error).toBeUndefined();
    expect(result.results).toHaveLength(1);
    expect(result.results[0].slug).toBe("daily-weekly");
    expect(result.results[0].result_index).toBe(1);
  });

  test("tells the model the ranking is approximate without naming the cause", async () => {
    mockFindRelevant.mockReturnValue([
      { slug: "slots", title: "Slots", content: "Spin the reels.", score: 0.3 },
    ]);

    const result = await callLookupKb();

    expect(result.note).toMatch(/approximate/i);
    // Provider state is not the user's business, and the model will paraphrase
    // whatever it is handed.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/embed|cloudflare|timed out|endpoint/i);
  });

  test("uses the looser explicit-lookup threshold, not the ambient one", async () => {
    mockFindRelevant.mockReturnValue([]);
    await callLookupKb();

    const [, , , minScore] = mockFindRelevant.mock.calls[0];
    expect(minScore).toBe(require("../../config.js").KB_LEXICAL_FALLBACK_MIN_SCORE);
    expect(minScore).toBeLessThan(require("../../config.js").KB_PREFLIGHT_MIN_SCORE);
  });

  test("a genuine no-match still reads as no-match, not as an error", async () => {
    mockFindRelevant.mockReturnValue([]);

    const result = await callLookupKb("something nobody documented");

    expect(result.error).toBeUndefined();
    expect(result.results).toEqual([]);
    expect(result.message).toMatch(/no matching/i);
  });

  test("long lexical content is truncated the same way semantic results are", async () => {
    mockFindRelevant.mockReturnValue([
      { slug: "long", title: "Long", content: "x".repeat(900), score: 0.5 },
    ]);

    const result = await callLookupKb();

    expect(result.results[0].content).toHaveLength(503);
    expect(result.results[0].content.endsWith("...")).toBe(true);
  });
});
