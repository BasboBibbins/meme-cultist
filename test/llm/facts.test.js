// Fact pipeline edge-case coverage for mergeFacts, sortAndPruneFacts, and legacy fallback behavior.

const assert = require("assert");
const { mergeFacts, sortAndPruneFacts } = require("../../utils/openai");

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
  // --- mergeFacts ---
  test("mergeFacts: adds new facts to empty array", () => {
    const result = mergeFacts([], [{ key: "job", value: "nurse", confidence: "high" }], "context");
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].key, "job");
    assert.strictEqual(result[0].value, "nurse");
  });

  test("mergeFacts: deduplicates by exact key match", () => {
    const existing = [{ key: "job", value: "nurse", confidence: "high", updatedAt: 1000 }];
    const incoming = [{ key: "job", value: "doctor", confidence: "high" }];
    const result = mergeFacts(existing, incoming, "context");
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].value, "doctor");
    assert.ok(result[0].updatedAt >= 1000, "updatedAt should be refreshed");
  });

  test("mergeFacts: preserves distinct keys", () => {
    const existing = [{ key: "job", value: "nurse" }];
    const incoming = [{ key: "hobby", value: "gaming" }];
    const result = mergeFacts(existing, incoming, "context");
    assert.strictEqual(result.length, 2);
  });

  test("mergeFacts: Jaccard similarity dedup — near-duplicate merged", () => {
    const existing = [{ key: "favorite_food", value: "pizza" }];
    const incoming = [{ key: "fav_food", value: "pizza" }];
    const result = mergeFacts(existing, incoming, "context");
    // Should deduplicate by Jaccard similarity on value
    assert.ok(result.length < 2, `Expected dedup, got ${result.length} facts`);
  });

  test("mergeFacts: __deleted__ fact removes existing", () => {
    const existing = [{ key: "sport", value: "tennis" }];
    const incoming = [{ key: "sport", value: "__deleted__" }];
    const result = mergeFacts(existing, incoming, "context");
    const found = result.find(f => f.key === "sport");
    assert.ok(!found || found.value === "__deleted__", "Existing fact should be removed or marked deleted");
  });

  test("mergeFacts: increments reinforcedCount on exact match", () => {
    const existing = [{ key: "job", value: "nurse", reinforcedCount: 2 }];
    const incoming = [{ key: "job", value: "nurse" }];
    const result = mergeFacts(existing, incoming, "context");
    assert.strictEqual(result[0].reinforcedCount, 3);
  });

  test("mergeFacts: sets confidence from incoming if present", () => {
    const existing = [{ key: "job", value: "nurse", confidence: "low" }];
    const incoming = [{ key: "job", value: "nurse", confidence: "high" }];
    const result = mergeFacts(existing, incoming, "context");
    assert.strictEqual(result[0].confidence, "high");
  });

  // --- sortAndPruneFacts ---
  test("sortAndPruneFacts: drops oldest unpinned facts when over MAX_FACTS", () => {
    const facts = [];
    for (let i = 0; i < 35; i++) {
      facts.push({
        key: `fact_${String(i).padStart(2, "0")}`,
        value: `value ${i}`,
        updatedAt: i * 1000,
        pinned: false,
      });
    }
    const result = sortAndPruneFacts(facts);
    assert.ok(result.length <= 30, `Expected <= 30, got ${result.length}`);
  });

  test("sortAndPruneFacts: never drops pinned facts", () => {
    const facts = [];
    for (let i = 0; i < 35; i++) {
      facts.push({
        key: `fact_${String(i).padStart(2, "0")}`,
        value: `value ${i}`,
        updatedAt: i * 1000,
        pinned: i < 10,
      });
    }
    const result = sortAndPruneFacts(facts);
    const pinnedCount = result.filter(f => f.pinned).length;
    assert.strictEqual(pinnedCount, 10, `Expected 10 pinned facts, got ${pinnedCount}`);
  });

  test("sortAndPruneFacts: pinned facts kept even when exceeding MAX_FACTS", () => {
    const facts = [];
    for (let i = 0; i < 35; i++) {
      facts.push({
        key: `fact_${String(i).padStart(2, "0")}`,
        value: `value ${i}`,
        updatedAt: i * 1000,
        pinned: i <= 27,
      });
    }
    const result = sortAndPruneFacts(facts);
    // 28 pinned out of 35 input; MAX_FACTS = 25.
    // Pinned facts are NEVER dropped, so all 28 are kept.
    // slotsForUnpinned = max(0, 25 - 28) = 0, so no unpinned facts survive.
    assert.strictEqual(result.length, 28);
    assert.strictEqual(result.filter(f => f.pinned).length, 28);
  });

  test("sortAndPruneFacts: sorts by updatedAt desc, then key asc", () => {
    const facts = [
      { key: "zebra", value: "z", updatedAt: 1000 },
      { key: "apple", value: "a", updatedAt: 3000 },
      { key: "mango", value: "m", updatedAt: 2000 },
    ];
    const result = sortAndPruneFacts(facts);
    assert.deepStrictEqual(result.map(f => f.key), ["apple", "mango", "zebra"]);
  });

  test("sortAndPruneFacts: handles missing updatedAt gracefully", () => {
    const facts = [
      { key: "a", value: "1" },
      { key: "b", value: "2", updatedAt: 1000 },
    ];
    const result = sortAndPruneFacts(facts);
    // missing updatedAt = 0, so b (1000) comes first
    assert.deepStrictEqual(result.map(f => f.key), ["b", "a"]);
  });

  test("sortAndPruneFacts: empty array returns empty array", () => {
    const result = sortAndPruneFacts([]);
    assert.deepStrictEqual(result, []);
  });

  test("sortAndPruneFacts: single fact returns single fact", () => {
    const result = sortAndPruneFacts([{ key: "a", value: "b" }]);
    assert.strictEqual(result.length, 1);
  });

  // --- Legacy parser equivalence (simulating schema-fallback path) ---
  test("legacy parser: key=value line splitting", () => {
    const output = "job=nurse\nhobby=gaming";
    const lines = output.split("\n").filter(line => line.includes("="));
    const parsed = lines.map(line => {
      const [rawKey, ...rest] = line.split("=");
      return { key: rawKey.trim(), value: rest.join("=").trim(), confidence: "high" };
    });
    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0].key, "job");
    assert.strictEqual(parsed[0].value, "nurse");
    assert.strictEqual(parsed[1].key, "hobby");
    assert.strictEqual(parsed[1].value, "gaming");
  });

  test("legacy parser: value contains equals signs", () => {
    const line = "equation=y=mx+b";
    const [rawKey, ...rest] = line.split("=");
    const parsed = { key: rawKey.trim(), value: rest.join("=").trim(), confidence: "high" };
    assert.strictEqual(parsed.key, "equation");
    assert.strictEqual(parsed.value, "y=mx+b");
  });

  test("legacy parser: ignores lines without equals", () => {
    const output = "job=nurse\nthis is a comment\nhobby=gaming";
    const lines = output.split("\n").filter(line => line.includes("="));
    assert.strictEqual(lines.length, 2);
  });

  test("legacy parser: empty string returns empty array", () => {
    const lines = "".split("\n").filter(line => line.includes("="));
    assert.deepStrictEqual(lines, []);
  });

  return { passed, failed };
}

module.exports = { run };
