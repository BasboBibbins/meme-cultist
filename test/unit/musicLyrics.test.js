// The bug this covers: lyrics over Discord's 4096 description limit made setDescription
// throw inside the same try that reported "could not find lyrics", so a song that was
// found and fetched successfully was reported to the user as missing.

const { formatLyrics, truncate, queryFor, DESCRIPTION_LIMIT } = require("../../utils/music/lyrics");

const URL = "https://genius.com/song";

describe("truncate", () => {
  test("leaves a short body untouched", () => {
    expect(truncate("short", URL)).toEqual({ text: "short", truncated: false });
  });

  test("keeps the result inside Discord's description limit", () => {
    const { text, truncated } = truncate("x".repeat(10000), URL);
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
  });

  test("links out to the full lyrics rather than silently dropping them", () => {
    expect(truncate("x".repeat(10000), URL).text).toContain(URL);
  });

  test("cuts on a line break so a verse does not end mid-word", () => {
    const body = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join("\n");
    const { text } = truncate(body, URL);
    const beforeNotice = text.split("\n\n-#")[0];
    expect(beforeNotice.endsWith("\n")).toBe(false);
    expect(body.startsWith(beforeNotice)).toBe(true);
  });

  test("falls back to a hard cut when there is no usable break", () => {
    const { text, truncated } = truncate("x".repeat(10000), URL);
    expect(truncated).toBe(true);
    expect(text).toContain("xxx");
  });

  test("survives a null body", () => {
    expect(truncate(null, URL)).toEqual({ text: "", truncated: false });
  });
});

describe("formatLyrics", () => {
  // Line 0 is always dropped: Genius prepends a "<Song> Lyrics" heading to every body.
  test("bolds section headers", () => {
    expect(formatLyrics("Creep Lyrics\n[Chorus]\nla")).toContain("**[Chorus]**");
  });

  test("drops the leading title line Genius prepends", () => {
    expect(formatLyrics("Song Title Lyrics\n[Verse]").split("\n")[0]).toBe("");
  });

  test("survives null", () => {
    expect(formatLyrics(null)).toBe("");
  });
});

describe("queryFor", () => {
  test("swaps a bridged 'Artist - Song' title so the search reads song first", () => {
    expect(queryFor({ title: "Radiohead - Creep", author: "Radiohead" })).toBe("Creep Radiohead");
  });

  test("appends the author for an unbridged title", () => {
    expect(queryFor({ title: "Creep", author: "Radiohead" })).toBe("Creep Radiohead");
  });

  test("returns empty for a track with no title rather than searching for undefined", () => {
    expect(queryFor({})).toBe("");
    expect(queryFor(null)).toBe("");
  });
});
