const {
  mergeDirectives,
  removeDirective,
  buildDirectivesBlock,
  similarity,
} = require("../../utils/directives");

describe("mergeDirectives", () => {
  test("adds a new directive with metadata", () => {
    const { directives, added } = mergeDirectives([], ["Never reveal Wordle answers."], {
      createdBy: "42",
      source: "tool",
      now: 1000,
    });
    expect(directives).toHaveLength(1);
    expect(added).toHaveLength(1);
    expect(directives[0]).toMatchObject({
      text: "Never reveal Wordle answers.",
      createdBy: "42",
      source: "tool",
      createdAt: 1000,
      updatedAt: 1000,
    });
    expect(typeof directives[0].id).toBe("string");
  });

  test("ids are always full length", () => {
    // Math.random().toString(36) is short when the value has a short base-36
    // expansion; a 1-character id would collide and make removal ambiguous.
    const spy = jest.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const { directives } = mergeDirectives([], ["Never reveal Wordle answers."], { now: 1000 });
      expect(directives[0].id).toHaveLength(6);
    } finally {
      spy.mockRestore();
    }
  });

  test("reinforces a near-duplicate instead of stacking it", () => {
    const first = mergeDirectives([], ["Never reveal the Wordle answer; give hints instead."], { now: 1000 });
    const second = mergeDirectives(first.directives, ["Never reveal the Wordle answer, give hints instead"], { now: 5000 });
    expect(second.directives).toHaveLength(1);
    expect(second.added).toHaveLength(0);
    expect(second.reinforced).toEqual([first.directives[0].id]);
    expect(second.directives[0].updatedAt).toBe(5000);
    expect(second.directives[0].createdAt).toBe(1000);
  });

  test("keeps distinct rules separate", () => {
    const { directives } = mergeDirectives([], [
      "Never reveal Wordle answers.",
      "Keep replies under three sentences.",
    ], { now: 1000 });
    expect(directives).toHaveLength(2);
  });

  test("drops the oldest entries beyond the cap", () => {
    const subjects = [
      "spoilers", "emoji", "pings", "wordle", "recipes",
      "politics", "birthdays", "screenshots", "translations", "poetry",
      "acronyms", "measurements",
    ];
    const incoming = subjects.map(s => `Never discuss ${s} unprompted.`);
    const { directives, dropped } = mergeDirectives([], incoming, { now: 1000 });
    expect(directives).toHaveLength(10);
    expect(dropped).toHaveLength(2);
    expect(directives[0].text).toBe("Never discuss pings unprompted.");
  });

  test("ignores empty and too-short input", () => {
    const { directives, added } = mergeDirectives([], ["", "  ", "no", null], { now: 1000 });
    expect(directives).toHaveLength(0);
    expect(added).toHaveLength(0);
  });

  test("does not mutate the input array", () => {
    const existing = [{ id: "abc123", text: "Keep replies short.", createdAt: 1, updatedAt: 1 }];
    mergeDirectives(existing, ["Never use emoji in replies."], { now: 2000 });
    expect(existing).toHaveLength(1);
  });
});

describe("removeDirective", () => {
  const seed = () => mergeDirectives([], [
    "Never reveal Wordle answers.",
    "Keep replies under three sentences.",
  ], { now: 1000 }).directives;

  test("removes by id", () => {
    const list = seed();
    const { directives, removed } = removeDirective(list, list[0].id);
    expect(removed.text).toBe("Never reveal Wordle answers.");
    expect(directives).toHaveLength(1);
  });

  test("removes by exact text", () => {
    const list = seed();
    const { removed } = removeDirective(list, "Keep replies under three sentences.");
    expect(removed.text).toBe("Keep replies under three sentences.");
  });

  test("removes by near-duplicate wording", () => {
    const list = seed();
    const { removed } = removeDirective(list, "never reveal the wordle answers");
    expect(removed.text).toBe("Never reveal Wordle answers.");
  });

  test("removes by a short fragment naming the rule", () => {
    const list = mergeDirectives([], ["Never discuss spoilers unprompted."], { now: 1000 }).directives;
    // Jaccard alone scores this 0.25 — far below threshold — so containment
    // matching is what makes retraction-by-topic work.
    const { removed, directives } = removeDirective(list, "spoilers");
    expect(removed.text).toBe("Never discuss spoilers unprompted.");
    expect(directives).toHaveLength(0);
  });

  test("a fragment matching no rule still removes nothing", () => {
    const list = seed();
    const { removed } = removeDirective(list, "jackpot");
    expect(removed).toBeNull();
  });

  test("returns null when nothing matches", () => {
    const list = seed();
    const { directives, removed } = removeDirective(list, "something completely unrelated");
    expect(removed).toBeNull();
    expect(directives).toHaveLength(2);
  });

  test("handles an empty needle", () => {
    const { removed } = removeDirective(seed(), "");
    expect(removed).toBeNull();
  });
});

describe("buildDirectivesBlock", () => {
  test("returns an empty string with no directives", () => {
    expect(buildDirectivesBlock([])).toBe("");
    expect(buildDirectivesBlock(null)).toBe("");
  });

  test("renders a numbered list with ids and the persistence rule", () => {
    const list = mergeDirectives([], ["Never reveal Wordle answers."], { now: 1000 }).directives;
    const block = buildDirectivesBlock(list);
    expect(block).toContain("[Standing Instructions]");
    expect(block).toContain("persist indefinitely");
    expect(block).toContain(`1. (${list[0].id}) Never reveal Wordle answers.`);
  });
});

describe("similarity", () => {
  test("scores unrelated text near zero", () => {
    expect(similarity("Never reveal Wordle answers", "Play music louder")).toBeLessThan(0.2);
  });

  test("ignores stopword-only overlap", () => {
    expect(similarity("the a of to", "the a of to")).toBe(0);
  });
});
