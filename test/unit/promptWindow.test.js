const { selectAnchoredWindow, pickFloor } = require("../../utils/promptWindow");

// Snowflake-shaped ids so BigInt comparison behaves like the real thing.
const BASE = 1000000000000000000n;
const id = n => String(BASE + BigInt(n));
const ids = (from, to) => {
  const out = [];
  for (let i = from; i <= to; i++) out.push(id(i));
  return out;
};

const MIN = 15;
const MAX = 30;
const select = overrides => selectAnchoredWindow({ min: MIN, max: MAX, anchorId: null, resetPointId: null, ...overrides });

describe("pickFloor", () => {
  test("prefers whichever of anchor and reset point is newer", () => {
    expect(pickFloor(id(5), id(9))).toBe(id(9));
    expect(pickFloor(id(9), id(5))).toBe(id(9));
  });

  test("tolerates either side being absent", () => {
    expect(pickFloor(null, id(3))).toBe(id(3));
    expect(pickFloor(id(3), null)).toBe(id(3));
    expect(pickFloor(null, null)).toBe(null);
  });
});

describe("selectAnchoredWindow", () => {
  test("first run adopts the oldest available message as the anchor", () => {
    const result = select({ ids: ids(1, 10) });
    expect(result.ids).toHaveLength(10);
    expect(result.nextAnchorId).toBe(id(1));
    expect(result.reanchored).toBe(false);
  });

  test("grows without re-anchoring while under the ceiling", () => {
    for (let n = MIN; n <= MAX; n++) {
      const result = select({ ids: ids(1, n), anchorId: id(1) });
      expect(result.reanchored).toBe(false);
      expect(result.nextAnchorId).toBe(id(1));
      expect(result.ids[0]).toBe(id(1));
    }
  });

  test("re-anchors once on crossing the ceiling, keeping the newest min", () => {
    const result = select({ ids: ids(1, MAX + 1), anchorId: id(1) });
    expect(result.reanchored).toBe(true);
    expect(result.ids).toHaveLength(MIN);
    expect(result.nextAnchorId).toBe(result.ids[0]);
    expect(result.ids[result.ids.length - 1]).toBe(id(MAX + 1));
  });

  test("drops everything at or before the anchor", () => {
    const result = select({ ids: ids(1, 20), anchorId: id(11) });
    expect(result.ids[0]).toBe(id(11));
    expect(result.ids).toHaveLength(10);
  });

  test("a reset point newer than the anchor wins", () => {
    const result = select({ ids: ids(1, 20), anchorId: id(3), resetPointId: id(15) });
    expect(result.ids[0]).toBe(id(15));
    expect(result.ids).toHaveLength(6);
  });

  test("a stale anchor re-anchors cleanly instead of emptying the window", () => {
    // Anchor points past every fetched message, e.g. its message was deleted.
    const result = select({ ids: ids(1, 10), anchorId: id(999) });
    expect(result.ids).toHaveLength(10);
    expect(result.reanchored).toBe(true);
    expect(result.nextAnchorId).toBe(id(1));
  });

  test("a non-numeric anchor does not throw", () => {
    expect(() => select({ ids: ids(1, 5), anchorId: "not-a-snowflake" })).not.toThrow();
  });

  test("handles empty, single-message, and missing input", () => {
    expect(select({ ids: [] })).toEqual({ ids: [], nextAnchorId: null, reanchored: false });
    expect(select({ ids: [id(1)] }).ids).toEqual([id(1)]);
    expect(select({ ids: undefined }).ids).toEqual([]);
  });

  // The payoff: a sliding window would move its head on all 40 turns.
  test("over 40 turns the window head moves only a handful of times", () => {
    let anchorId = null;
    const heads = [];
    for (let turn = 1; turn <= 40; turn++) {
      const result = select({ ids: ids(1, turn), anchorId });
      anchorId = result.nextAnchorId;
      heads.push(result.ids[0]);
    }
    const distinctHeads = new Set(heads.filter(Boolean));
    expect(distinctHeads.size).toBeLessThanOrEqual(3);
  });
});
