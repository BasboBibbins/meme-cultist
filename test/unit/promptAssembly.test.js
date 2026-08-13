const {
  assembleSystemPrompt,
  assembleTurnContext,
  formatAgeBucket,
} = require("../../utils/openai-system-prompts");

const ALL_SYSTEM_PARTS = {
  variantPrefix: "[VARIANT]",
  identityRulesBlock: "[IDENTITY]",
  discordFormattingBlock: "[FORMATTING]",
  turnContextLegendBlock: "[LEGEND]",
  toolBlock: "[TOOLS]",
  emojiBlock: "[EMOJI]",
  directivesBlock: "[DIRECTIVES]",
  topicBlock: "[TOPIC]",
  channelSummaryBlock: "[CHANNEL_SUMMARY]",
  participantsBlock: "[PARTICIPANTS]",
};

const ALL_TURN_PARTS = {
  channelFactsBlock: "[CHANNEL_FACTS]",
  userSummaryBlock: "[USER_SUMMARY]",
  userFactsBlock: "[USER_FACTS]",
  kbContextBlock: "[KB]",
  perceptionBlock: "[PERCEPTION_CAPS]",
  perceptionPayload: "[PERCEPTION]",
  turnModeBlock: "[TURN_MODE]",
  replyBlock: "[REPLY_TO]",
  nowBlock: "[NOW]",
  userLine: "[user_1] alex: hi",
};

describe("assembleSystemPrompt", () => {
  test("emits the canonical order, static blocks first", () => {
    expect(assembleSystemPrompt(ALL_SYSTEM_PARTS).split("\n\n")).toEqual([
      "[VARIANT]",
      "[IDENTITY]",
      "[FORMATTING]",
      "[LEGEND]",
      "[TOOLS]",
      "[EMOJI]",
      "[DIRECTIVES]",
      "[PARTICIPANTS]",
      "[CHANNEL_SUMMARY]",
      "[TOPIC]",
    ]);
  });

  test("omits falsy sections", () => {
    const result = assembleSystemPrompt({
      variantPrefix: "[VARIANT]",
      topicBlock: null,
      directivesBlock: "",
      toolBlock: undefined,
      participantsBlock: "[PARTICIPANTS]",
    });
    expect(result).toBe("[VARIANT]\n\n[PARTICIPANTS]");
  });

  // The whole point of the ordering: a topic refresh must not invalidate the
  // static blocks above it.
  test("a changed topic leaves every other block intact", () => {
    const a = assembleSystemPrompt({ ...ALL_SYSTEM_PARTS, topicBlock: "[TOPIC A]" });
    const b = assembleSystemPrompt({ ...ALL_SYSTEM_PARTS, topicBlock: "[TOPIC B]" });
    const sharedPrefix = a.slice(0, a.indexOf("[TOPIC A]"));
    expect(b.startsWith(sharedPrefix)).toBe(true);
    expect(sharedPrefix).toContain("[TOOLS]");
    expect(sharedPrefix).toContain("[DIRECTIVES]");
    expect(sharedPrefix).toContain("[PARTICIPANTS]");
    expect(sharedPrefix).toContain("[CHANNEL_SUMMARY]");
  });

  // Mention turns drop both, so keeping them last is what lets the two share a prefix.
  test("dropping topic and summary preserves the prefix a mention turn shares", () => {
    const ambient = assembleSystemPrompt(ALL_SYSTEM_PARTS);
    const mention = assembleSystemPrompt({
      ...ALL_SYSTEM_PARTS,
      topicBlock: undefined,
      channelSummaryBlock: undefined,
    });
    expect(ambient.startsWith(mention)).toBe(true);
    expect(mention).toContain("[PARTICIPANTS]");
  });

  test("no volatile turn-scoped block can reach the system prompt", () => {
    const result = assembleSystemPrompt({ ...ALL_SYSTEM_PARTS, ...ALL_TURN_PARTS });
    for (const marker of ["[CHANNEL_FACTS]", "[USER_FACTS]", "[USER_SUMMARY]", "[KB]", "[NOW]", "[TURN_MODE]", "[REPLY_TO]"]) {
      expect(result).not.toContain(marker);
    }
  });

  test("turn-context changes never alter the system string", () => {
    const base = assembleSystemPrompt(ALL_SYSTEM_PARTS);
    assembleTurnContext({ ...ALL_TURN_PARTS, userLine: "something else entirely" });
    expect(assembleSystemPrompt(ALL_SYSTEM_PARTS)).toBe(base);
  });
});

describe("assembleTurnContext", () => {
  test("emits the canonical order with the user line last", () => {
    const parts = assembleTurnContext(ALL_TURN_PARTS).split("\n\n");
    expect(parts).toEqual([
      "[CHANNEL_FACTS]",
      "[USER_SUMMARY]",
      "[USER_FACTS]",
      "[KB]",
      "[PERCEPTION_CAPS]",
      "[PERCEPTION]",
      "[TURN_MODE]",
      "[REPLY_TO]",
      "[NOW]",
      "[user_1] alex: hi",
    ]);
    expect(parts[parts.length - 1]).toBe("[user_1] alex: hi");
  });

  test("the user line stays last when every other block is absent", () => {
    expect(assembleTurnContext({ userLine: "[user_1] alex: hi" })).toBe("[user_1] alex: hi");
  });

  test("omits falsy sections", () => {
    expect(assembleTurnContext({
      channelFactsBlock: "",
      kbContextBlock: null,
      nowBlock: "[NOW]",
      userLine: "[user_1] alex: hi",
    })).toBe("[NOW]\n\n[user_1] alex: hi");
  });
});

describe("formatAgeBucket", () => {
  const now = Date.UTC(2026, 6, 30, 12, 0, 0);
  const hoursAgo = h => now - h * 3600000;

  test.each([
    [0, "just now"],
    [1.9, "just now"],
    [2, "earlier today"],
    [7.9, "earlier today"],
    [8, "today"],
    [23.9, "today"],
    [24, "yesterday"],
    [47.9, "yesterday"],
    [48, "this week"],
    [167.9, "this week"],
    [168, "older"],
    [1000, "older"],
  ])("%p hours ago → %p", (hours, expected) => {
    expect(formatAgeBucket(hoursAgo(hours), now)).toBe(expected);
  });

  test("holds still across a minute, unlike the old per-minute label", () => {
    expect(formatAgeBucket(hoursAgo(1), now)).toBe(formatAgeBucket(hoursAgo(1), now + 60000));
  });

  test("missing timestamp reads as fresh", () => {
    expect(formatAgeBucket(null, now)).toBe("just now");
    expect(formatAgeBucket(0, now)).toBe("just now");
  });

  test("a future timestamp clamps instead of going negative", () => {
    expect(formatAgeBucket(now + 3600000, now)).toBe("just now");
  });
});
