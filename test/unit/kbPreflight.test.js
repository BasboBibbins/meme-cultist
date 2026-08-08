jest.mock("../../utils/kb/store", () => ({ listForGuild: jest.fn() }));

const store = require("../../utils/kb/store");
const kbPreflight = require("../../utils/kb/preflight");

const ENTRIES = [
  {
    slug: "daily-weekly",
    title: "Dailies and Weeklies",
    tags: "economy",
    content: "Claim free koku every day and week. Dailies carry a streak bonus that resets if you miss a day.",
  },
  {
    slug: "slots",
    title: "Slots",
    tags: "games,gambling",
    content: "Spin the slot machine and line up matching symbols across paylines. Scatters trigger free spins.",
  },
  {
    slug: "music",
    title: "Music Player",
    tags: "music",
    content: "Play music with the play command. The bot joins your voice channel and queues the track.",
  },
];

beforeEach(() => {
  store.listForGuild.mockReset();
  store.listForGuild.mockReturnValue(ENTRIES);
  kbPreflight.invalidate();
});

describe("findRelevant", () => {
  test("matches an entry from an oblique mention", () => {
    const matches = kbPreflight.findRelevant("g1", "ugh I keep losing my streak", 2);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].slug).toBe("daily-weekly");
  });

  test("weights title hits above body hits", () => {
    const matches = kbPreflight.findRelevant("g1", "how do slots paylines work", 3);
    expect(matches[0].slug).toBe("slots");
  });

  test("returns nothing for unrelated chatter", () => {
    expect(kbPreflight.findRelevant("g1", "anyway what did you have for lunch", 2)).toEqual([]);
  });

  test("still matches when the topic sits inside a long message", () => {
    // Scoring must not be diluted by unrelated words, or pre-flight would
    // silently stop firing whenever someone writes more than a sentence.
    const verbose = "okay so anyway I was thinking earlier about totally unrelated "
      + "matters involving weekend plans and errands and whatever else, but honestly "
      + "the thing bugging me most is that I keep losing my streak somehow";
    const matches = kbPreflight.findRelevant("g1", verbose, 2);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].slug).toBe("daily-weekly");
  });

  test("scores are bounded to 1", () => {
    const matches = kbPreflight.findRelevant("g1", "dailies weeklies streak koku economy", 3);
    for (const m of matches) expect(m.score).toBeLessThanOrEqual(1);
  });

  test("respects the requested limit", () => {
    const matches = kbPreflight.findRelevant("g1", "streak bonus paylines voice channel", 1);
    expect(matches.length).toBeLessThanOrEqual(1);
  });

  test("returns long content whole, leaving truncation to the caller", () => {
    const content = "streak ".repeat(400);
    store.listForGuild.mockReturnValue([{
      slug: "long",
      title: "Streak Handbook",
      tags: "economy",
      content,
    }]);
    kbPreflight.invalidate();
    const [match] = kbPreflight.findRelevant("g1", "tell me about the streak handbook", 1);
    expect(match.content).toBe(content);
  });

  test("returns nothing on empty input or empty knowledge base", () => {
    expect(kbPreflight.findRelevant("g1", "")).toEqual([]);
    expect(kbPreflight.findRelevant("", "streak")).toEqual([]);
    store.listForGuild.mockReturnValue([]);
    kbPreflight.invalidate();
    expect(kbPreflight.findRelevant("g1", "streak")).toEqual([]);
  });

  test("degrades to empty rather than throwing when the store fails", () => {
    store.listForGuild.mockImplementation(() => { throw new Error("db down"); });
    kbPreflight.invalidate();
    expect(kbPreflight.findRelevant("g1", "streak bonus")).toEqual([]);
  });
});

describe("invalidate", () => {
  test("rebuilds the index after entries change", () => {
    expect(kbPreflight.findRelevant("g1", "paylines", 2)[0].slug).toBe("slots");
    store.listForGuild.mockReturnValue([ENTRIES[2]]);
    kbPreflight.invalidate("g1");
    expect(kbPreflight.findRelevant("g1", "paylines", 2)).toEqual([]);
  });

  test("caches the index between calls", () => {
    kbPreflight.findRelevant("g1", "streak", 2);
    kbPreflight.findRelevant("g1", "paylines", 2);
    expect(store.listForGuild).toHaveBeenCalledTimes(1);
  });
});

describe("buildKbContextBlock", () => {
  test("returns an empty string with no matches", () => {
    expect(kbPreflight.buildKbContextBlock([])).toBe("");
  });

  test("renders slug-tagged entries with retrieval framing", () => {
    const block = kbPreflight.buildKbContextBlock([{ slug: "slots", title: "Slots", content: "Spin." }]);
    expect(block).toContain("[KnowledgeBase]");
    expect(block).toContain("[[kb:slots]] Slots");
    expect(block).toContain("lookup_kb");
  });

  test("leaves an entry under the cap untouched and unmarked", () => {
    const content = "Spin the reels and match symbols across paylines.";
    const block = kbPreflight.buildKbContextBlock([{ slug: "slots", title: "Slots", content }]);
    expect(block).toContain(content);
    expect(block).not.toContain("Entry truncated");
  });

  test("marks a clipped entry so the model knows to follow up", () => {
    const content = `${"word ".repeat(400)}TAIL`;
    const block = kbPreflight.buildKbContextBlock([{ slug: "long", title: "Streak Handbook", content }]);
    expect(block).not.toContain("TAIL");
    expect(block).toContain("Entry truncated");
    expect(block).toContain("Call lookup_kb with query \"Streak Handbook\"");
  });

  test("clips on a paragraph boundary rather than mid-word", () => {
    const first = "a".repeat(500);
    const content = `${first}\n\n${"b".repeat(500)}`;
    const block = kbPreflight.buildKbContextBlock([{ slug: "long", title: "Long", content }]);
    expect(block).toContain(first);
    expect(block).not.toContain("b".repeat(10));
  });

  test("never emits a mid-word cut when no boundary is available", () => {
    const content = `${"supercalifragilistic ".repeat(80)}end`;
    const block = kbPreflight.buildKbContextBlock([{ slug: "long", title: "Long", content }]);
    const body = block.split("[[kb:long]] Long\n")[1].split("\n[Entry truncated")[0];
    expect(body.endsWith("supercalifragilistic")).toBe(true);
  });
});
