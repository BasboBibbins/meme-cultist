const {
  tokenize,
  jaccard,
  containsAllTokens,
  CORE_STOPWORDS,
  RETRIEVAL_STOPWORDS,
} = require("../../utils/text");

describe("tokenize", () => {
  test("lowercases, splits on non-alphanumerics, and drops stopwords", () => {
    expect(tokenize("I love Earl-Grey tea!")).toEqual(["love", "earl", "grey", "tea"]);
  });

  test("drops tokens below the minimum length", () => {
    expect(tokenize("a b cd efg", 3)).toEqual(["efg"]);
  });

  test("tolerates null and empty input", () => {
    expect(tokenize(null)).toEqual([]);
    expect(tokenize("")).toEqual([]);
  });

  test("retrieval stopwords strip question words that core keeps", () => {
    expect(tokenize("what do you want to know", 2, CORE_STOPWORDS)).toContain("want");
    expect(tokenize("what do you want to know", 2, RETRIEVAL_STOPWORDS)).toEqual([]);
  });

  test("core set stays narrow so fact values keep their content words", () => {
    // Widening CORE would silently change fact dedup in utils/openai.js.
    for (const word of ["like", "want", "know", "think", "have", "about"]) {
      expect(CORE_STOPWORDS.has(word)).toBe(false);
    }
  });
});

describe("jaccard", () => {
  test("identical phrasing scores 1", () => {
    expect(jaccard("never reveal wordle answers", "never reveal wordle answers")).toBe(1);
  });

  test("unrelated text scores low", () => {
    expect(jaccard("never reveal wordle answers", "play music louder")).toBeLessThan(0.2);
  });

  test("stopword-only input scores 0", () => {
    expect(jaccard("the a of to", "the a of to")).toBe(0);
  });

  test("accepts pre-built sets", () => {
    expect(jaccard(new Set(["cat"]), new Set(["cat"]))).toBe(1);
  });
});

describe("containsAllTokens", () => {
  test("matches a fragment fully contained in the phrase", () => {
    expect(containsAllTokens("Never discuss spoilers unprompted.", "spoilers")).toBe(true);
    expect(containsAllTokens("Never discuss spoilers unprompted.", "discuss spoilers")).toBe(true);
  });

  test("rejects a fragment with any token missing", () => {
    expect(containsAllTokens("Never discuss spoilers unprompted.", "spoilers jackpot")).toBe(false);
  });

  test("an all-stopword needle matches nothing", () => {
    expect(containsAllTokens("Never discuss spoilers.", "the of")).toBe(false);
  });
});
