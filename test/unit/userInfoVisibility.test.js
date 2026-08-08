// Phase 1 of cross-user memory visibility: stored chatbot memory is disclosed
// only to its subject.
//
// Drives the real executeToolCall path rather than the handler directly, so the
// validation/dedup/decoration layers are exercised the same way the ReAct loop
// exercises them. Everything openai-tools pulls in at require time is mocked —
// the module opens SQLite and a job queue otherwise.

const mockUserRecords = new Map();

jest.mock("../../database", () => ({
  db: {
    get: jest.fn(async id => mockUserRecords.get(id) ?? null),
  },
}));

jest.mock("../../utils/logger", () => ({
  log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

jest.mock("../../utils/bank", () => ({ getCurrentTopUsers: jest.fn(), getAllTimeTopUsers: jest.fn() }));
jest.mock("../../utils/llm", () => ({ generateImage: jest.fn(), embed: jest.fn() }));
jest.mock("../../utils/ratelimiter", () => ({ canGenerateImage: jest.fn(() => ({ allowed: true })) }));
jest.mock("../../utils/kb", () => ({}));
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

const SELF_ID = "111111111111111111";
const OTHER_ID = "222222222222222222";

function makeMember(id, name) {
  return {
    id,
    user: { username: name, createdAt: new Date("2020-01-01T00:00:00Z") },
    displayName: name,
    nickname: null,
    displayAvatarURL: () => `https://cdn.example/${id}.png`,
    roles: { cache: new Map() },
    joinedAt: new Date("2021-01-01T00:00:00Z"),
  };
}

// roles.cache is iterated with .filter().map().slice() — Map gives filter/map
// via discord.js Collection normally, so stub the three methods used.
function withRoleHelpers(member) {
  member.roles.cache = {
    filter: () => ({ map: () => ({ slice: () => [] }) }),
  };
  return member;
}

const selfMember = withRoleHelpers(makeMember(SELF_ID, "self-user"));
const otherMember = withRoleHelpers(makeMember(OTHER_ID, "other-user"));

function makeMessage() {
  return {
    author: { id: SELF_ID },
    member: selfMember,
    guild: {
      id: "guild-1",
      members: {
        cache: new Map([[SELF_ID, selfMember], [OTHER_ID, otherMember]]),
        fetch: jest.fn(async id => (id === SELF_ID ? selfMember : otherMember)),
      },
    },
  };
}

function callGetUserInfo(args = {}) {
  return executeToolCall(
    { function: { name: "get_user_info", arguments: JSON.stringify(args) } },
    makeMessage(),
    {},
    null,
  );
}

beforeEach(() => {
  mockUserRecords.clear();
  mockUserRecords.set(SELF_ID, {
    balance: 500,
    bank: 100,
    chatbot: {
      messageCount: 42,
      facts: [{ key: "favorite_drink", value: "coffee", subjectUserId: SELF_ID }],
      summaries: [{ context: "self summary" }],
    },
  });
  mockUserRecords.set(OTHER_ID, {
    balance: 900,
    bank: 200,
    chatbot: {
      messageCount: 7,
      facts: [{ key: "secret_crush", value: "someone", subjectUserId: OTHER_ID }],
      summaries: [{ context: "other user private summary" }],
    },
  });
});

describe("get_user_info — asking about yourself", () => {
  test("returns your own facts and summary", async () => {
    const result = await callGetUserInfo({ user_id: SELF_ID });
    expect(result.user_facts).toEqual([
      { key: "favorite_drink", value: "coffee", subjectUserId: SELF_ID },
    ]);
    expect(result.user_summary).toEqual({ context: "self summary" });
    expect(result.memory_visibility).toBeUndefined();
  });

  test("defaults to the caller when no user_id is given", async () => {
    const result = await callGetUserInfo();
    expect(result.user_id).toBe(SELF_ID);
    expect(result.user_facts).toHaveLength(1);
  });

  test("a user with no stored facts gets an empty array, not an omission", async () => {
    mockUserRecords.set(SELF_ID, { balance: 0, bank: 0, chatbot: { messageCount: 0, facts: [], summaries: [] } });
    const result = await callGetUserInfo({ user_id: SELF_ID });
    expect(result).toHaveProperty("user_facts");
    expect(result.user_facts).toEqual([]);
    expect(result.memory_visibility).toBeUndefined();
  });
});

describe("get_user_info — asking about someone else", () => {
  test("omits the memory keys entirely rather than emptying them", async () => {
    const result = await callGetUserInfo({ user_id: OTHER_ID });
    // Absence is the point: `user_facts: []` reads to the model as a positive
    // claim that the person has no stored facts.
    expect(result).not.toHaveProperty("user_facts");
    expect(result).not.toHaveProperty("user_summary");
  });

  test("flags why the memory is missing", async () => {
    const result = await callGetUserInfo({ user_id: OTHER_ID });
    expect(result.memory_visibility).toBe("self_only");
  });

  test("never leaks the other user's fact values anywhere in the payload", async () => {
    const result = await callGetUserInfo({ user_id: OTHER_ID });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret_crush");
    expect(serialized).not.toContain("other user private summary");
  });

  test("leaves the non-memory fields intact — this is a scoping fix, not a lockdown", async () => {
    const result = await callGetUserInfo({ user_id: OTHER_ID });
    expect(result.user_id).toBe(OTHER_ID);
    expect(result.balance).toBe(900);
    expect(result.bank).toBe(200);
    expect(result.chatbot_msg_count).toBe(7);
    expect(result.joined_at).toBeDefined();
    expect(result.account_created).toBeDefined();
  });
});

describe("get_user_info — tool description", () => {
  test("tells the model not to reconstruct memory it was denied", () => {
    const { TOOLS } = require("../../utils/openai-tools");
    const tool = TOOLS.find(t => t.function.name === "get_user_info");
    expect(tool.function.description).toMatch(/self_only/);
    expect(tool.function.description).toMatch(/do not infer or reconstruct/i);
  });
});
