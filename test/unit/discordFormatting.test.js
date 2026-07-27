const {
  buildEmojiIndex,
  buildEmojiBlock,
  buildMemberIndex,
  repairDiscordFormatting,
} = require("../../utils/openai");

// Minimal guild stub: buildEmojiIndex only touches guild.emojis.cache.values().
function guildWithEmoji(entries) {
  return { emojis: { cache: new Map(entries.map(e => [e.id, e])) } };
}

// participants map shaped like the identity registry, keyed by user ID.
// Real Discord snowflakes so the user_NNN repair (17-20 digits) is exercised.
const ALICE = "100000000000000111";
const BOB = "100000000000000222";
const PARTICIPANTS = {
  [ALICE]: { currentName: "Alice", namesSeen: ["Alice"] },
  [BOB]: { currentName: "Bob", namesSeen: ["Bobby", "Bob"] },
};

describe("buildMemberIndex", () => {
  test("maps current and former names (lowercased) to the user ID", () => {
    const idx = buildMemberIndex(PARTICIPANTS, [ALICE, BOB]);
    expect(idx.get("alice")).toBe(ALICE);
    expect(idx.get("bob")).toBe(BOB);
    expect(idx.get("bobby")).toBe(BOB);
  });

  test("drops names shared by more than one participant", () => {
    const dupe = {
      "1": { currentName: "Sam", namesSeen: ["Sam"] },
      "2": { currentName: "Sam", namesSeen: ["Sam"] },
    };
    const idx = buildMemberIndex(dupe, ["1", "2"]);
    expect(idx.has("sam")).toBe(false);
  });

  test("only includes present IDs", () => {
    const idx = buildMemberIndex(PARTICIPANTS, [ALICE]);
    expect(idx.get("alice")).toBe(ALICE);
    expect(idx.has("bob")).toBe(false);
  });
});

describe("buildEmojiIndex / buildEmojiBlock", () => {
  test("builds name → token map, animated flagged", () => {
    const idx = buildEmojiIndex(guildWithEmoji([
      { id: "10", name: "blobwave", animated: false },
      { id: "11", name: "party", animated: true },
    ]));
    expect(idx.get("blobwave")).toBe("<:blobwave:10>");
    expect(idx.get("party")).toBe("<a:party:11>");
  });

  test("empty guild yields empty index and empty block", () => {
    expect(buildEmojiIndex(undefined).size).toBe(0);
    expect(buildEmojiBlock(new Map())).toBe("");
  });

  test("block lists sorted entries under the header", () => {
    const idx = buildEmojiIndex(guildWithEmoji([
      { id: "2", name: "zeta", animated: false },
      { id: "1", name: "alpha", animated: false },
    ]));
    const block = buildEmojiBlock(idx);
    expect(block.startsWith("[Server Emoji]")).toBe(true);
    expect(block.indexOf(":alpha:")).toBeLessThan(block.indexOf(":zeta:"));
  });
});

describe("repairDiscordFormatting", () => {
  const emojiIndex = buildEmojiIndex(guildWithEmoji([{ id: "10", name: "blobwave", animated: false }]));
  const ctx = { memberIndex: buildMemberIndex(PARTICIPANTS, [ALICE, BOB]), emojiIndex };

  test("converts an exact @name to a real ping", () => {
    expect(repairDiscordFormatting("hey @Alice look", ctx)).toBe(`hey <@${ALICE}> look`);
  });

  test("converts a quoted @\"Display Name\"", () => {
    const c = { memberIndex: buildMemberIndex({ "5": { currentName: "Cool Guy", namesSeen: ["Cool Guy"] } }, ["5"]), emojiIndex: new Map() };
    expect(repairDiscordFormatting('ping @"Cool Guy" now', c)).toBe("ping <@5> now");
  });

  test("leaves unknown @handles untouched", () => {
    expect(repairDiscordFormatting("email me@example nope", ctx)).toBe("email me@example nope");
    expect(repairDiscordFormatting("@Nobody here", ctx)).toBe("@Nobody here");
  });

  test("does not match @ preceded by a word char (emails)", () => {
    expect(repairDiscordFormatting("foo@Alice.com", ctx)).toBe("foo@Alice.com");
  });

  test("leaves ambiguous names alone", () => {
    const dupe = { memberIndex: buildMemberIndex({ "1": { currentName: "Sam", namesSeen: ["Sam"] }, "2": { currentName: "Sam", namesSeen: ["Sam"] } }, ["1", "2"]), emojiIndex: new Map() };
    expect(repairDiscordFormatting("yo @Sam", dupe)).toBe("yo @Sam");
  });

  test("rewrites leaked user_NNN into a ping", () => {
    expect(repairDiscordFormatting(`tell [user_${BOB}] hi`, ctx)).toBe(`tell <@${BOB}> hi`);
    expect(repairDiscordFormatting(`user_${ALICE} won`, ctx)).toBe(`<@${ALICE}> won`);
  });

  test("resolves a known custom :emoji:", () => {
    expect(repairDiscordFormatting("nice :blobwave: yo", ctx)).toBe("nice <:blobwave:10> yo");
  });

  test("leaves unknown :emoji: shortcodes alone", () => {
    expect(repairDiscordFormatting("so :smile: cool", ctx)).toBe("so :smile: cool");
  });

  test("does not touch content inside code spans", () => {
    expect(repairDiscordFormatting("`ping @Alice`", ctx)).toBe("`ping @Alice`");
    expect(repairDiscordFormatting("```\n@Alice :blobwave:\n```", ctx)).toBe("```\n@Alice :blobwave:\n```");
  });

  test("does not re-rewrite already-valid tokens", () => {
    expect(repairDiscordFormatting(`hi <@${ALICE}> and <:blobwave:10>`, ctx)).toBe(`hi <@${ALICE}> and <:blobwave:10>`);
  });

  test("never produces @everyone or @here", () => {
    const out = repairDiscordFormatting("yo @everyone and @here", ctx);
    expect(out).toBe("yo @everyone and @here");
  });

  test("passes through empty/whitespace text", () => {
    expect(repairDiscordFormatting("", ctx)).toBe("");
    expect(repairDiscordFormatting(null, ctx)).toBe(null);
  });
});

describe("repairDiscordFormatting — hallucinated ID validation", () => {
  const emojiIndex = new Map();
  const knownIds = new Set([ALICE, BOB]);
  const ctx = { memberIndex: buildMemberIndex(PARTICIPANTS, [ALICE, BOB]), emojiIndex, knownIds };

  test("keeps a mention whose ID is known", () => {
    expect(repairDiscordFormatting(`hey <@${ALICE}> hi`, ctx)).toBe(`hey <@${ALICE}> hi`);
    expect(repairDiscordFormatting(`hey <@!${BOB}> hi`, ctx)).toBe(`hey <@!${BOB}> hi`);
  });

  test("strips a mention whose ID is not known, tidying the gap", () => {
    expect(repairDiscordFormatting("hey <@999999999999999999> look", ctx)).toBe("hey look");
    expect(repairDiscordFormatting("ping <@999999999999999999>, now", ctx)).toBe("ping, now");
  });

  test("does not strip when no knownIds set is provided", () => {
    const noValidate = { memberIndex: new Map(), emojiIndex: new Map() };
    expect(repairDiscordFormatting("hey <@999999999999999999> look", noValidate)).toBe("hey <@999999999999999999> look");
  });

  test("leaves role and channel tokens alone", () => {
    expect(repairDiscordFormatting("see <@&123456789012345678> and <#987654321098765432>", ctx))
      .toBe("see <@&123456789012345678> and <#987654321098765432>");
  });

  test("does not validate mentions inside code spans", () => {
    expect(repairDiscordFormatting("`<@999999999999999999>`", ctx)).toBe("`<@999999999999999999>`");
  });

  test("converts a name and validates in the same pass", () => {
    expect(repairDiscordFormatting("yo @Alice and <@999999999999999999>", ctx)).toBe(`yo <@${ALICE}> and`);
  });
});
