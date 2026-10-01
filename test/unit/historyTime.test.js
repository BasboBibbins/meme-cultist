const { DAY_MS, parseRange, groupConversations, selectConversations, pickRepresentative, coverageGaps, isoDate } = require("../../utils/historyTime");

const at = (iso) => Date.parse(iso);
const HOUR = 3600000;

describe("parseRange", () => {
  test("no bounds means no range", () => {
    expect(parseRange({})).toBeNull();
    expect(parseRange()).toBeNull();
  });

  test("date-only bounds are UTC midnight and before is exclusive", () => {
    expect(parseRange({ after: "2025-01-01", before: "2026-01-01" })).toEqual({ afterMs: at("2025-01-01T00:00:00Z"), beforeMs: at("2026-01-01T00:00:00Z") });
  });

  test("a bare date-time is treated as UTC, matching [Now]", () => {
    expect(parseRange({ after: "2026-09-21T12:00" }).afterMs).toBe(at("2026-09-21T12:00:00Z"));
  });

  test("an explicit offset is honoured", () => {
    expect(parseRange({ after: "2026-09-21T00:00-04:00" }).afterMs).toBe(at("2026-09-21T04:00:00Z"));
  });

  test("open-ended ranges are allowed", () => {
    expect(parseRange({ after: "2026-09-21" })).toEqual({ afterMs: at("2026-09-21"), beforeMs: null });
    expect(parseRange({ before: "2025-06-01" })).toEqual({ afterMs: null, beforeMs: at("2025-06-01") });
  });

  test("rejects non-ISO and inverted ranges", () => {
    expect(parseRange({ after: "last week" }).error).toMatch(/ISO/);
    expect(parseRange({ after: "2026-09-28", before: "2026-09-21" }).error).toMatch(/earlier/);
    expect(parseRange({ after: "2026-09-21", before: "2026-09-21" }).error).toMatch(/earlier/);
  });
});

describe("groupConversations", () => {
  const row = (id, iso) => ({ id, created_at: at(iso) });

  test("splits on silence longer than the gap", () => {
    const rows = [row(1, "2026-09-21T10:00Z"), row(2, "2026-09-21T12:00Z"), row(3, "2026-09-21T20:00Z")];
    expect(groupConversations(rows, 6 * HOUR).map(g => g.map(r => r.id))).toEqual([[1, 2], [3]]);
  });

  test("a gap of exactly the threshold stays in one conversation", () => {
    const rows = [row(1, "2026-09-21T10:00Z"), row(2, "2026-09-21T16:00Z")];
    expect(groupConversations(rows, 6 * HOUR)).toHaveLength(1);
  });

  test("empty input gives no conversations", () => {
    expect(groupConversations([], 6 * HOUR)).toEqual([]);
  });
});

describe("selectConversations", () => {
  const groups = [[1], [2, 2, 2], [3], [4, 4], [5]];

  test("returns everything under the cap", () => {
    expect(selectConversations(groups, 10, "relevance")).toBe(groups);
  });

  test("oldest and newest take the edges", () => {
    expect(selectConversations(groups, 2, "oldest")).toEqual([[1], [2, 2, 2]]);
    expect(selectConversations(groups, 2, "newest")).toEqual([[4, 4], [5]]);
  });

  test("otherwise keeps the largest, back in time order", () => {
    expect(selectConversations(groups, 2, "relevance")).toEqual([[2, 2, 2], [4, 4]]);
  });
});

describe("pickRepresentative", () => {
  const vec = (...v) => Float32Array.from(v);
  const msg = (id, author, content, v, t = id) => ({ id, author_id: author, content, created_at: t, embedding: v });

  test("leaves out the off-topic message and returns picks in time order", () => {
    const rows = [
      msg(1, "u1", "on topic a", vec(1, 0.1)),
      msg(2, "u2", "off topic", vec(-1, 0)),
      msg(3, "u1", "on topic b", vec(1, 0)),
      msg(4, "u3", "on topic c", vec(0.9, 0.2)),
    ];
    const picked = pickRepresentative(rows, 2, "bot").map(r => r.id);
    expect(picked).toHaveLength(2);
    expect(picked).not.toContain(2);
    expect(picked).toEqual([...picked].sort((a, b) => a - b));
  });

  test("skips the bot's own messages when users spoke", () => {
    const rows = [msg(1, "bot", "long bot reply", vec(1, 0)), msg(2, "u1", "user line", vec(0, 1))];
    expect(pickRepresentative(rows, 1, "bot").map(r => r.id)).toEqual([2]);
  });

  test("falls back to the bot's messages when nobody else spoke", () => {
    const rows = [msg(1, "bot", "solo", vec(1, 0))];
    expect(pickRepresentative(rows, 3, "bot").map(r => r.id)).toEqual([1]);
  });

  test("without embeddings, takes the opener plus the longest messages", () => {
    const rows = [msg(1, "u1", "hi", null), msg(2, "u2", "a much longer message", null), msg(3, "u1", "mid length", null)];
    expect(pickRepresentative(rows, 2, "bot").map(r => r.id)).toEqual([1, 2]);
  });

  test("reads raw SQLite BLOB buffers", () => {
    const blob = (a) => Buffer.from(Float32Array.from(a).buffer);
    const rows = [msg(1, "u1", "a", blob([1, 0])), msg(2, "u1", "b", blob([1, 0.1])), msg(3, "u1", "c", blob([-1, 0]))];
    expect(pickRepresentative(rows, 1, "bot")).toHaveLength(1);
  });
});

describe("coverageGaps", () => {
  const range = { afterMs: at("2025-01-01"), beforeMs: at("2026-01-01") };
  const now = at("2026-09-29");

  test("reports leading, internal, and trailing holes inside the range", () => {
    const weekly = (from, to) => { const out = []; for (let t = at(from); t <= at(to); t += 7 * DAY_MS) out.push(t); return out; };
    const ts = [...weekly("2025-04-16", "2025-05-31"), ...weekly("2025-10-03", "2025-11-30")];
    const gaps = coverageGaps(ts, range, { now }).map(([a, b]) => [isoDate(a), isoDate(b)]);
    expect(gaps).toEqual([["2025-01-01", "2025-04-16"], ["2025-05-28", "2025-10-03"], ["2025-11-28", "2026-01-01"]]);
  });

  test("an empty range is one gap", () => {
    expect(coverageGaps([], range, { now })).toEqual([[range.afterMs, range.beforeMs]]);
  });

  test("never reports the future as a gap", () => {
    const future = { afterMs: at("2026-09-01"), beforeMs: at("2026-12-01") };
    const gaps = coverageGaps([at("2026-09-02"), at("2026-09-12"), at("2026-09-22"), at("2026-09-28")], future, { now });
    expect(gaps).toEqual([]);
  });

  test("respects the minimum gap", () => {
    const ts = [at("2025-01-01"), at("2025-01-10"), at("2025-12-31")];
    expect(coverageGaps(ts, range, { now, minGapMs: 400 * DAY_MS })).toEqual([]);
  });
});
