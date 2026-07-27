const { buildCueTokens, scoreFacts, buildFactsBlock } = require("../../utils/openai");

const DAY = 24 * 60 * 60 * 1000;

function fact(key, value, overrides = {}) {
  return {
    key,
    value,
    confidence: "high",
    reinforcedCount: 3,
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("buildCueTokens", () => {
  test("collects tokens across every supplied text", () => {
    const tokens = buildCueTokens("look at my cat", "a grey tabby on a couch");
    expect(tokens.has("cat")).toBe(true);
    expect(tokens.has("tabby")).toBe(true);
    expect(tokens.has("couch")).toBe(true);
  });

  test("drops stopwords and single characters", () => {
    const tokens = buildCueTokens("i was at the a");
    expect(tokens.size).toBe(0);
  });

  test("tolerates null and empty input", () => {
    expect(buildCueTokens(null, "", undefined).size).toBe(0);
  });
});

describe("scoreFacts", () => {
  test("with no cues, ordering matches the recency+reinforcement baseline", () => {
    const now = Date.now();
    const facts = [
      fact("pet_cat_name", "Mochi", { updatedAt: now - 60 * DAY }),
      fact("favorite_drink", "espresso", { updatedAt: now }),
    ];
    const scored = scoreFacts(facts, now).sort((a, b) => b._score - a._score);
    expect(scored[0].key).toBe("favorite_drink");
  });

  test("a cue-matching stale fact outranks a recent unrelated one", () => {
    const now = Date.now();
    const facts = [
      fact("pet_cat_name", "Mochi", { updatedAt: now - 60 * DAY }),
      fact("favorite_drink", "espresso", { updatedAt: now }),
    ];
    const cues = buildCueTokens("a grey tabby cat asleep on a couch");
    const scored = scoreFacts(facts, now, cues).sort((a, b) => b._score - a._score);
    expect(scored[0].key).toBe("pet_cat_name");
  });

  test("an empty cue set falls back to the baseline weighting", () => {
    const now = Date.now();
    const facts = [fact("pet_cat_name", "Mochi", { updatedAt: now - 60 * DAY })];
    expect(scoreFacts(facts, now, new Set())[0]._score).toBeCloseTo(scoreFacts(facts, now)[0]._score);
  });

  test("cue tokens that match nothing leave relative order intact", () => {
    const now = Date.now();
    const facts = [
      fact("pet_cat_name", "Mochi", { updatedAt: now - 60 * DAY }),
      fact("favorite_drink", "espresso", { updatedAt: now }),
    ];
    const cues = buildCueTokens("completely unrelated bicycle repair talk");
    const scored = scoreFacts(facts, now, cues).sort((a, b) => b._score - a._score);
    expect(scored[0].key).toBe("favorite_drink");
  });
});

describe("buildFactsBlock", () => {
  test("cue relevance decides which facts win a tight budget", () => {
    const now = Date.now();
    const facts = [
      fact("pet_cat_name", "Mochi", { updatedAt: now - 60 * DAY }),
      fact("favorite_drink", "espresso", { updatedAt: now }),
      fact("favorite_show", "Columbo", { updatedAt: now }),
    ];
    const cues = buildCueTokens("a grey tabby cat asleep on a couch");
    const block = buildFactsBlock("UserFacts", facts, 1, cues);
    expect(block).toContain("pet_cat_name: Mochi");
    expect(block).not.toContain("favorite_drink");
  });

  test("selected facts stay alphabetically ordered for cache stability", () => {
    const now = Date.now();
    const facts = [
      fact("zebra_fact", "z", { updatedAt: now }),
      fact("apple_fact", "a", { updatedAt: now - DAY }),
    ];
    const body = buildFactsBlock("UserFacts", facts, 2, buildCueTokens("zebra"));
    expect(body.indexOf("apple_fact")).toBeLessThan(body.indexOf("zebra_fact"));
  });

  test("core identity facts keep their slot regardless of cues", () => {
    const now = Date.now();
    const facts = [
      fact("name", "Alice", { updatedAt: now - 80 * DAY }),
      fact("favorite_drink", "espresso", { updatedAt: now }),
    ];
    const block = buildFactsBlock("UserFacts", facts, 1, buildCueTokens("espresso please"));
    expect(block).toContain("name: Alice");
  });

  test("returns an empty string when there is nothing to show", () => {
    expect(buildFactsBlock("UserFacts", [], 5, buildCueTokens("cat"))).toBe("");
  });
});
