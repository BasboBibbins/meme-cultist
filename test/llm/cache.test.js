// Cache optimization edge-case coverage for assembleSystemPrompt + buildFactsBlock behavior.

const assert = require("assert");
const { assembleSystemPrompt, assembleTurnContext } = require("../../utils/openai-system-prompts");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL: ${name} — ${err.message}`);
  }
}

function run() {
  // --- assembleSystemPrompt: canonical ordering ---
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

  test("canonical order: all 10 system sections present", () => {
    const parts = assembleSystemPrompt(ALL_SYSTEM_PARTS).split("\n\n");
    assert.deepStrictEqual(parts, [
      "[VARIANT]",
      "[IDENTITY]",
      "[FORMATTING]",
      "[LEGEND]",
      "[TOOLS]",
      "[EMOJI]",
      "[DIRECTIVES]",
      "[TOPIC]",
      "[CHANNEL_SUMMARY]",
      "[PARTICIPANTS]",
    ]);
  });

  test("canonical order: omits falsy sections", () => {
    const result = assembleSystemPrompt({
      variantPrefix: "[VARIANT]",
      topicBlock: null,
      directivesBlock: "",
      channelSummaryBlock: "[SUMMARY]",
      participantsBlock: "[PARTICIPANTS]",
    });
    assert.deepStrictEqual(result.split("\n\n"), ["[VARIANT]", "[SUMMARY]", "[PARTICIPANTS]"]);
  });

  test("canonical order: static behavioral rules at position 0", () => {
    const result = assembleSystemPrompt({
      variantPrefix: "Static rules here",
      participantsBlock: "Participants here",
    });
    assert.strictEqual(result.split("\n\n")[0], "Static rules here");
  });

  test("canonical order: static blocks precede every mutable one", () => {
    const result = assembleSystemPrompt(ALL_SYSTEM_PARTS);
    const idx = marker => result.indexOf(marker);
    assert.ok(idx("[IDENTITY]") < idx("[DIRECTIVES]"), "Identity before directives");
    assert.ok(idx("[TOOLS]") < idx("[DIRECTIVES]"), "Tools before directives");
    assert.ok(idx("[TOOLS]") < idx("[TOPIC]"), "Tools before topic");
    assert.ok(idx("[DIRECTIVES]") < idx("[TOPIC]"), "Directives before topic");
    assert.ok(idx("[TOPIC]") < idx("[CHANNEL_SUMMARY]"), "Topic before channel summary");
    assert.ok(idx("[CHANNEL_SUMMARY]") < idx("[PARTICIPANTS]"), "Channel summary before participants");
  });

  test("canonical order: turn-scoped blocks never enter the system prompt", () => {
    const result = assembleSystemPrompt({
      ...ALL_SYSTEM_PARTS,
      channelFactsBlock: "[CHANNEL_FACTS]",
      userFactsBlock: "[USER_FACTS]",
      userSummaryBlock: "[USER_SUMMARY]",
      kbContextBlock: "[KB]",
      perceptionBlock: "[PERCEPTION]",
      nowBlock: "[NOW]",
      dynamicTail: "[TAIL]",
    });
    for (const marker of ["[CHANNEL_FACTS]", "[USER_FACTS]", "[USER_SUMMARY]", "[KB]", "[PERCEPTION]", "[NOW]", "[TAIL]"]) {
      assert.ok(!result.includes(marker), `${marker} must not appear in the system prompt`);
    }
  });

  // --- assembleTurnContext ---
  test("turn context: canonical order with the user line last", () => {
    const parts = assembleTurnContext({
      channelFactsBlock: "[CHANNEL_FACTS]",
      userSummaryBlock: "[USER_SUMMARY]",
      userFactsBlock: "[USER_FACTS]",
      kbContextBlock: "[KB]",
      perceptionBlock: "[PERCEPTION_CAPS]",
      perceptionPayload: "[PERCEPTION]",
      turnModeBlock: "[TURN_MODE]",
      replyBlock: "[REPLY_TO]",
      nowBlock: "[NOW]",
      userLine: "[USER_LINE]",
    }).split("\n\n");
    assert.deepStrictEqual(parts, [
      "[CHANNEL_FACTS]",
      "[USER_SUMMARY]",
      "[USER_FACTS]",
      "[KB]",
      "[PERCEPTION_CAPS]",
      "[PERCEPTION]",
      "[TURN_MODE]",
      "[REPLY_TO]",
      "[NOW]",
      "[USER_LINE]",
    ]);
  });

  test("turn context: user line stays last when everything else is absent", () => {
    assert.strictEqual(assembleTurnContext({ userLine: "[USER_LINE]" }), "[USER_LINE]");
  });

  // --- Section isolation for cache stability ---
  test("isolation: a changed topic preserves the prefix through the tool block", () => {
    const a = assembleSystemPrompt({ ...ALL_SYSTEM_PARTS, topicBlock: "[TOPIC A]" });
    const b = assembleSystemPrompt({ ...ALL_SYSTEM_PARTS, topicBlock: "[TOPIC B]" });
    const shared = a.slice(0, a.indexOf("[TOPIC A]"));
    assert.ok(b.startsWith(shared), "Prefix before the topic must be byte-identical");
    assert.ok(shared.includes("[TOOLS]"), "Tool block must sit inside the shared prefix");
    assert.ok(shared.includes("[DIRECTIVES]"), "Directives must sit inside the shared prefix");
  });

  test("isolation: turn context changes leave the system prompt untouched", () => {
    const base = assembleSystemPrompt(ALL_SYSTEM_PARTS);
    assembleTurnContext({ nowBlock: "Current time: 12:00", userLine: "hi" });
    assembleTurnContext({ nowBlock: "Current time: 12:01", userLine: "bye" });
    assert.strictEqual(assembleSystemPrompt(ALL_SYSTEM_PARTS), base, "System prompt must be identical");
  });

  test("isolation: adding a fact cannot shift any system section", () => {
    const base = assembleSystemPrompt(ALL_SYSTEM_PARTS);
    const withFact = assembleSystemPrompt({ ...ALL_SYSTEM_PARTS, channelFactsBlock: "NEW_FACT" });
    assert.strictEqual(withFact, base, "Facts live in the turn context, not the system prompt");
  });

  // --- buildFactsBlock key-sorting (behavioral test via exported helpers) ---
  test("facts alphabetical stability: mergeFacts preserves key order after sort", () => {
    // Note: buildFactsBlock is internal, but sortAndPruneFacts is exported.
    // We verify the sorting behavior used for cache stability.
    const { sortAndPruneFacts } = require("../../utils/openai");
    const facts = [
      { key: "zebra", value: "z", updatedAt: 1000 },
      { key: "apple", value: "a", updatedAt: 2000 },
      { key: "mango", value: "m", updatedAt: 1500 },
    ];
    const result = sortAndPruneFacts(facts);
    const keys = result.map(f => f.key);
    // sortAndPruneFacts sorts by updatedAt desc, then key asc
    assert.deepStrictEqual(keys, ["apple", "mango", "zebra"]);
  });

  test("facts alphabetical stability: same updatedAt sorts by key", () => {
    const { sortAndPruneFacts } = require("../../utils/openai");
    const facts = [
      { key: "zebra", value: "z", updatedAt: 1000 },
      { key: "apple", value: "a", updatedAt: 1000 },
      { key: "mango", value: "m", updatedAt: 1000 },
    ];
    const result = sortAndPruneFacts(facts);
    const keys = result.map(f => f.key);
    assert.deepStrictEqual(keys, ["apple", "mango", "zebra"]);
  });

  return { passed, failed };
}

module.exports = { run };
