// Cover for the queue rendering that used to hand EmbedBuilder an empty string.
// setDescription("") throws, so a queue with a track playing and nothing after it
// took /queue view down with a bare "There was an error while executing this command!".

const { queuePage, queueString, formatClock, totalDurationMs, trackArray, staticProgress } = require("../../utils/music/format");

const track = (n, durationMS = 60000) => ({
  title: `Song ${n}`, author: `Artist ${n}`, url: `https://example.com/${n}`,
  duration: "1:00", durationMS,
});

// The real store is a @discord-player/utils Queue, which exposes toArray().
const store = items => ({ toArray: () => items, size: items.length });

describe("trackArray", () => {
  test("reads a discord-player track store", () => {
    expect(trackArray(store([track(1)]))).toHaveLength(1);
  });

  test("accepts a plain array", () => {
    expect(trackArray([track(1), track(2)])).toHaveLength(2);
  });

  test("survives null rather than throwing", () => {
    expect(trackArray(null)).toEqual([]);
    expect(trackArray(undefined)).toEqual([]);
  });
});

describe("queuePage", () => {
  test("never returns an empty description, which EmbedBuilder rejects", () => {
    const { text, total, pages } = queuePage(store([]));
    expect(text.length).toBeGreaterThan(0);
    expect(total).toBe(0);
    expect(pages).toBe(1);
  });

  test("numbers tracks by absolute position, not position within the page", () => {
    const tracks = Array.from({ length: 25 }, (_, i) => track(i + 1));
    const { text } = queuePage(store(tracks), 3);
    expect(text).toContain("**21.**");
    expect(text).not.toContain("**1.**");
  });

  test("clamps a page beyond the end instead of rendering nothing", () => {
    const { page, text } = queuePage(store([track(1), track(2)]), 99);
    expect(page).toBe(1);
    expect(text).toContain("**1.**");
  });

  test("clamps a page below one", () => {
    expect(queuePage(store([track(1)]), 0).page).toBe(1);
    expect(queuePage(store([track(1)]), -5).page).toBe(1);
  });

  test("reports the totals the caller labels the page with", () => {
    const tracks = Array.from({ length: 12 }, (_, i) => track(i + 1));
    const { total, pages, durationMs } = queuePage(store(tracks));
    expect(total).toBe(12);
    expect(pages).toBe(2);
    expect(durationMs).toBe(12 * 60000);
  });

  test("links a track when it has a url and bolds it when it does not", () => {
    expect(queuePage(store([track(1)])).text).toContain("[Song 1](https://example.com/1)");
    expect(queuePage(store([{ title: "Bare", author: "A" }])).text).toContain("**Bare**");
  });
});

describe("queueString", () => {
  test("returns a sentence rather than an empty string for an empty queue", () => {
    expect(queueString([]).length).toBeGreaterThan(0);
  });
});

describe("formatClock", () => {
  test.each([
    [0, "0:00"],
    [-1, "0:00"],
    [1000, "0:01"],
    [61000, "1:01"],
    [3600000, "1:00:00"],
    [3661000, "1:01:01"],
  ])("renders %ims as %s", (ms, expected) => {
    expect(formatClock(ms)).toBe(expected);
  });

  test("never renders NaN", () => {
    expect(formatClock(undefined)).toBe("0:00");
    expect(formatClock(NaN)).toBe("0:00");
  });
});

describe("totalDurationMs", () => {
  test("ignores tracks whose duration never resolved", () => {
    expect(totalDurationMs([track(1), { title: "x" }, track(2)])).toBe(120000);
  });
});

describe("staticProgress", () => {
  const queue = elapsed => ({ node: { getTimestamp: () => ({ current: { value: elapsed } }) } });

  test("renders elapsed of total rather than a bar that goes stale", () => {
    expect(staticProgress(queue(30000), { durationMS: 210000 })).toContain("0:30 / 3:30");
  });

  test("says so, so the reader knows it does not tick", () => {
    expect(staticProgress(queue(0), { durationMS: 1000 })).toContain("at the time this was posted");
  });

  test("labels a live stream instead of timing it", () => {
    expect(staticProgress(queue(0), { isStream: true })).toBe("🔴 LIVE");
  });

  test("renders nothing when the duration is unknown", () => {
    expect(staticProgress(queue(0), { durationMS: 0 })).toBe("");
  });
});
