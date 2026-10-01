const { ftsTokens, buildFTSQueries, fuseRankings } = require("../../utils/ftsQuery");

describe("ftsTokens", () => {
  test("drops stopwords and short words, lowercases, dedupes", () => {
    expect(ftsTokens("What did Spook say about Spook's JULIA?")).toEqual(["spook", "julia"]);
  });

  test("keeps unicode letters and digits", () => {
    expect(ftsTokens("café 2026 naïve")).toEqual(["café", "2026", "naïve"]);
  });

  test("empty and non-string input give no tokens", () => {
    expect(ftsTokens("")).toEqual([]);
    expect(ftsTokens(null)).toEqual([]);
    expect(ftsTokens("is it a")).toEqual([]);
  });
});

describe("buildFTSQueries", () => {
  test("quotes every token for both the strict and loose forms", () => {
    expect(buildFTSQueries("star wars movies")).toEqual({
      tokens: ["star", "wars", "movies"],
      all: "\"star\" AND \"wars\" AND \"movies\"",
      any: "\"star\" OR \"wars\" OR \"movies\"",
    });
  });

  test.each([
    ["commas", "star wars movies, star tours"],
    ["question marks", "what did Spook say about Julia?"],
    ["column syntax", "samsung 32:9 ultrawide"],
    ["hyphens", "Basbo Original Night-Hawk race win"],
    ["periods", "Merlin \"Mr. Mercenary\" koku"],
    ["slashes", "bot said the n word / used racial slur"],
    ["operators", "NOT this OR that AND NEAR(x) ^start *"],
  ])("never emits FTS5 syntax for %s", (_, raw) => {
    const q = buildFTSQueries(raw);
    for (const form of [q.all, q.any]) {
      const unquoted = form.replace(/"[^"]*"/g, "");
      expect(unquoted.replace(/\b(AND|OR)\b/g, "").trim()).toBe("");
    }
  });

  test("returns null when nothing searchable remains", () => {
    expect(buildFTSQueries("what is it?")).toBeNull();
  });
});

describe("fuseRankings", () => {
  const row = (id, author = "u") => ({ id, author_id: author });

  test("a row found by both lists outranks rows found by one", () => {
    const fused = fuseRankings([[row(1), row(2)], [row(3), row(2)]], { limit: 3 });
    expect(fused[0].id).toBe(2);
  });

  test("keeps rows that only one list found", () => {
    const fused = fuseRankings([[row(1)], []], { limit: 5 });
    expect(fused.map(r => r.id)).toEqual([1]);
  });

  test("weighting pushes a row below an equal peer", () => {
    const fused = fuseRankings([[row(1, "bot"), row(2, "u")]], {
      limit: 2,
      weightFor: r => (r.author_id === "bot" ? 0.5 : 1),
    });
    expect(fused.map(r => r.id)).toEqual([2, 1]);
  });

  test("respects the limit and tolerates empty input", () => {
    expect(fuseRankings([[row(1), row(2), row(3)]], { limit: 2 })).toHaveLength(2);
    expect(fuseRankings([[], []])).toEqual([]);
  });
});
