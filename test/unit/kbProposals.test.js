const { slugify, dedupHash } = require("../../utils/kbProposals/store");

describe("kbProposals.slugify", () => {
  test("lowercases and hyphenates a title", () => {
    expect(slugify("Server Rules")).toBe("server-rules");
  });

  test("strips punctuation and collapses separators", () => {
    expect(slugify("What's the @event schedule?!")).toBe("what-s-the-event-schedule");
  });

  test("trims leading and trailing separators", () => {
    expect(slugify("  --Lore: The Beginning--  ")).toBe("lore-the-beginning");
  });

  test("produces a kb-compatible slug (a-z0-9-, max 64)", () => {
    const slug = slugify("X".repeat(200));
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug).toMatch(/^[a-z0-9-]{1,64}$/);
  });

  test("never ends on a hyphen after truncation", () => {
    const slug = slugify(`${"word ".repeat(20)}`);
    expect(slug.endsWith("-")).toBe(false);
  });

  test("falls back to 'entry' when nothing usable remains", () => {
    expect(slugify("!!!")).toBe("entry");
    expect(slugify("")).toBe("entry");
  });
});

describe("kbProposals.dedupHash", () => {
  test("is stable across whitespace and case differences", () => {
    const a = dedupHash("g1", "Server Rules", "No spamming allowed");
    const b = dedupHash("g1", "server   rules", "  no SPAMMING allowed ");
    expect(a).toBe(b);
  });

  test("differs by guild", () => {
    expect(dedupHash("g1", "t", "c")).not.toBe(dedupHash("g2", "t", "c"));
  });

  test("differs by content", () => {
    expect(dedupHash("g1", "t", "c1")).not.toBe(dedupHash("g1", "t", "c2"));
  });
});
