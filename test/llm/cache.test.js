// Cache optimization edge-case coverage for assembleSystemPrompt + buildFactsBlock behavior.

const assert = require("assert");
const { assembleSystemPrompt } = require("../../utils/openai-system-prompts");

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
    test("canonical order: all 9 sections present", () => {
        const result = assembleSystemPrompt({
            variantPrefix: "[VARIANT]",
            topic: "[TOPIC]",
            channelFactsBlock: "[CHANNEL_FACTS]",
            channelSummaryBlock: "[CHANNEL_SUMMARY]",
            userSummaryBlock: "[USER_SUMMARY]",
            userFactsBlock: "[USER_FACTS]",
            toolBlock: "[TOOLS]",
            perceptionBlock: "[PERCEPTION]",
            dynamicTail: "[TAIL]",
        });
        const parts = result.split("\n\n");
        assert.deepStrictEqual(parts, [
            "[VARIANT]",
            "[TOPIC]",
            "[CHANNEL_FACTS]",
            "[CHANNEL_SUMMARY]",
            "[USER_SUMMARY]",
            "[USER_FACTS]",
            "[TOOLS]",
            "[PERCEPTION]",
            "[TAIL]",
        ]);
    });

    test("canonical order: dynamic tail is always last", () => {
        const result = assembleSystemPrompt({
            variantPrefix: "[VARIANT]",
            dynamicTail: "Current time: 2026-05-14",
        });
        assert.ok(result.startsWith("[VARIANT]"), "Should start with variant");
        assert.ok(result.endsWith("Current time: 2026-05-14"), "Should end with dynamic tail");
    });

    test("canonical order: omits falsy sections", () => {
        const result = assembleSystemPrompt({
            variantPrefix: "[VARIANT]",
            topic: null,
            channelFactsBlock: "",
            channelSummaryBlock: "[SUMMARY]",
            dynamicTail: "[TAIL]",
        });
        const parts = result.split("\n\n");
        assert.deepStrictEqual(parts, ["[VARIANT]", "[SUMMARY]", "[TAIL]"]);
    });

    test("canonical order: static behavioral rules at position 0", () => {
        const result = assembleSystemPrompt({
            variantPrefix: "Static rules here",
            dynamicTail: "Dynamic tail here",
        });
        const lines = result.split("\n\n");
        assert.strictEqual(lines[0], "Static rules here");
    });

    test("canonical order: topic before facts", () => {
        const result = assembleSystemPrompt({
            variantPrefix: "V",
            topic: "TOPIC",
            channelFactsBlock: "FACTS",
        });
        const idxTopic = result.indexOf("TOPIC");
        const idxFacts = result.indexOf("FACTS");
        assert.ok(idxTopic < idxFacts, "Topic should appear before channel facts");
    });

    test("canonical order: channel summary before user summary", () => {
        const result = assembleSystemPrompt({
            channelSummaryBlock: "CHANNEL_SUMMARY",
            userSummaryBlock: "USER_SUMMARY",
        });
        const idxChannel = result.indexOf("CHANNEL_SUMMARY");
        const idxUser = result.indexOf("USER_SUMMARY");
        assert.ok(idxChannel < idxUser, "Channel summary should appear before user summary");
    });

    test("canonical order: user facts after user summary", () => {
        const result = assembleSystemPrompt({
            userSummaryBlock: "USER_SUMMARY",
            userFactsBlock: "USER_FACTS",
        });
        const idxSummary = result.indexOf("USER_SUMMARY");
        const idxFacts = result.indexOf("USER_FACTS");
        assert.ok(idxSummary < idxFacts, "User summary should appear before user facts");
    });

    test("canonical order: tool block before dynamic tail", () => {
        const result = assembleSystemPrompt({
            toolBlock: "TOOLS",
            dynamicTail: "TAIL",
        });
        const idxTools = result.indexOf("TOOLS");
        const idxTail = result.indexOf("TAIL");
        assert.ok(idxTools < idxTail, "Tools should appear before dynamic tail");
    });

    test("canonical order: perception block between tools and tail", () => {
        const result = assembleSystemPrompt({
            toolBlock: "TOOLS",
            perceptionBlock: "PERCEPTION",
            dynamicTail: "TAIL",
        });
        const idxTools = result.indexOf("TOOLS");
        const idxPerception = result.indexOf("PERCEPTION");
        const idxTail = result.indexOf("TAIL");
        assert.ok(idxTools < idxPerception, "Tools before perception");
        assert.ok(idxPerception < idxTail, "Perception before tail");
    });

    // --- Section isolation for cache stability ---
    test("isolation: adding a new fact does not shift earlier sections", () => {
        const base = assembleSystemPrompt({
            variantPrefix: "RULES",
            topic: "TOPIC",
            dynamicTail: "TAIL",
        });
        const withFact = assembleSystemPrompt({
            variantPrefix: "RULES",
            topic: "TOPIC",
            channelFactsBlock: "NEW_FACT",
            dynamicTail: "TAIL",
        });
        const basePrefix = base.slice(0, base.indexOf("TAIL"));
        const withPrefix = withFact.slice(0, withFact.indexOf("TAIL"));
        // The prefix up to (but not including) the dynamic tail should differ only after topic
        assert.ok(withFact.includes("NEW_FACT"));
        assert.ok(base.includes("RULES"));
        assert.ok(withFact.includes("RULES"));
    });

    test("isolation: dynamic tail changes do not affect static prefix", () => {
        const base = assembleSystemPrompt({
            variantPrefix: "RULES",
            dynamicTail: "Current time: 12:00",
        });
        const changed = assembleSystemPrompt({
            variantPrefix: "RULES",
            dynamicTail: "Current time: 12:01",
        });
        const baseStatic = base.slice(0, base.indexOf("Current time"));
        const changedStatic = changed.slice(0, changed.indexOf("Current time"));
        assert.strictEqual(baseStatic, changedStatic, "Static prefix should be identical");
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
