const {
  KENO_TOTAL_NUMBERS,
  KENO_DRAW_COUNT,
  KENO_MAX_SPOTS,
  PAYTABLE,
  parseSpots,
  quickPick,
  drawNumbers,
  countMatches,
  getMultiplier,
  matchProbability,
  expectedReturn,
  resolveKeno,
} = require("../../utils/keno");

function seededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe("drawNumbers", () => {
  test("returns 20 distinct numbers in 1..80 over many seeded runs", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const drawn = drawNumbers(seededRng(seed));
      expect(drawn).toHaveLength(KENO_DRAW_COUNT);
      expect(new Set(drawn).size).toBe(KENO_DRAW_COUNT);
      for (const n of drawn) {
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(KENO_TOTAL_NUMBERS);
      }
    }
  });

  test("returns numbers in ascending order", () => {
    const drawn = drawNumbers(seededRng(42));
    expect([...drawn].sort((a, b) => a - b)).toEqual(drawn);
  });

  test("covers the whole board across many draws", () => {
    const seen = new Set();
    for (let seed = 1; seed <= 200; seed++) {
      for (const n of drawNumbers(seededRng(seed))) seen.add(n);
    }
    expect(seen.size).toBe(KENO_TOTAL_NUMBERS);
  });
});

describe("quickPick", () => {
  test("returns the requested count, distinct and in range", () => {
    for (let count = 1; count <= KENO_MAX_SPOTS; count++) {
      const picks = quickPick(count, seededRng(count * 7));
      expect(picks).toHaveLength(count);
      expect(new Set(picks).size).toBe(count);
      expect(Math.min(...picks)).toBeGreaterThanOrEqual(1);
      expect(Math.max(...picks)).toBeLessThanOrEqual(KENO_TOTAL_NUMBERS);
    }
  });

  test("clamps out-of-range counts into 1..KENO_MAX_SPOTS", () => {
    expect(quickPick(0, seededRng(1))).toHaveLength(1);
    expect(quickPick(-5, seededRng(1))).toHaveLength(1);
    expect(quickPick(99, seededRng(1))).toHaveLength(KENO_MAX_SPOTS);
  });
});

describe("parseSpots", () => {
  test("accepts comma and space separators", () => {
    expect(parseSpots("1, 5, 12").spots).toEqual([1, 5, 12]);
    expect(parseSpots("1 5 12").spots).toEqual([1, 5, 12]);
    expect(parseSpots("  12,5 , 1  ").spots).toEqual([1, 5, 12]);
  });

  test("returns picks sorted ascending", () => {
    expect(parseSpots("80 1 40").spots).toEqual([1, 40, 80]);
  });

  test("rejects duplicates", () => {
    const result = parseSpots("4, 9, 4");
    expect(result.spots).toBeUndefined();
    expect(result.error).toMatch(/more than once/i);
  });

  test("rejects out-of-range values", () => {
    expect(parseSpots("0").error).toMatch(/out of range/i);
    expect(parseSpots("81").error).toMatch(/out of range/i);
  });

  test("rejects an empty pick", () => {
    expect(parseSpots("").error).toMatch(/between/i);
    expect(parseSpots("   ").error).toMatch(/between/i);
    expect(parseSpots(null).error).toMatch(/between/i);
  });

  test("rejects more than the maximum number of spots", () => {
    const result = parseSpots("1,2,3,4,5,6,7,8,9,10,11");
    expect(result.error).toMatch(/at most/i);
  });

  test("rejects non-numeric junk", () => {
    expect(parseSpots("1, banana, 3").error).toMatch(/isn't a whole number/i);
    expect(parseSpots("1.5").error).toMatch(/isn't a whole number/i);
    expect(parseSpots("-4").error).toMatch(/isn't a whole number/i);
  });
});

describe("countMatches", () => {
  test("counts the intersection", () => {
    expect(countMatches([1, 2, 3], [2, 3, 40])).toBe(2);
  });

  test("returns 0 when nothing overlaps", () => {
    expect(countMatches([1, 2, 3], [4, 5, 6])).toBe(0);
  });

  test("returns the full count on a complete hit", () => {
    expect(countMatches([7, 14, 21], [7, 14, 21, 30, 55])).toBe(3);
  });
});

describe("PAYTABLE", () => {
  test("every spot count 1..10 has exactly spots + 1 entries", () => {
    for (let spots = 1; spots <= KENO_MAX_SPOTS; spots++) {
      expect(PAYTABLE[spots]).toBeDefined();
      expect(PAYTABLE[spots]).toHaveLength(spots + 1);
    }
  });

  test("multipliers never decrease as match count rises", () => {
    for (let spots = 1; spots <= KENO_MAX_SPOTS; spots++) {
      const row = PAYTABLE[spots];
      for (let m = 1; m < row.length; m++) {
        expect(row[m]).toBeGreaterThanOrEqual(row[m - 1]);
      }
    }
  });

  test("a full hit always pays", () => {
    for (let spots = 1; spots <= KENO_MAX_SPOTS; spots++) {
      expect(getMultiplier(spots, spots)).toBeGreaterThan(1);
    }
  });

  test("getMultiplier returns 0 for unknown spot counts and impossible matches", () => {
    expect(getMultiplier(0, 0)).toBe(0);
    expect(getMultiplier(11, 5)).toBe(0);
    expect(getMultiplier(3, 9)).toBe(0);
  });
});

describe("matchProbability", () => {
  test("the distribution sums to 1 for every spot count", () => {
    for (let spots = 1; spots <= KENO_MAX_SPOTS; spots++) {
      let total = 0;
      for (let m = 0; m <= spots; m++) total += matchProbability(spots, m);
      expect(total).toBeCloseTo(1, 10);
    }
  });

  test("a one-spot ticket hits a quarter of the time", () => {
    expect(matchProbability(1, 1)).toBeCloseTo(KENO_DRAW_COUNT / KENO_TOTAL_NUMBERS, 12);
  });
});

describe("expectedReturn", () => {
  test("every spot count returns between 93% and 97%", () => {
    for (let spots = 1; spots <= KENO_MAX_SPOTS; spots++) {
      const rtp = expectedReturn(spots);
      expect(rtp).toBeGreaterThanOrEqual(0.93);
      expect(rtp).toBeLessThanOrEqual(0.97);
    }
  });

  test("returns 0 for a spot count with no paytable row", () => {
    expect(expectedReturn(0)).toBe(0);
    expect(expectedReturn(11)).toBe(0);
  });
});

describe("resolveKeno", () => {
  test("payout is the bet times the multiplier, floored", () => {
    const rng = seededRng(9);
    const spots = quickPick(5, seededRng(9));
    const result = resolveKeno({ spots, bet: 333, rng });
    expect(result.payout).toBe(Math.floor(333 * result.multiplier));
    expect(result.net).toBe(result.payout - 333);
  });

  test("matched entries are exactly the picks that were drawn", () => {
    const result = resolveKeno({ spots: [1, 2, 3, 4, 5], bet: 100, rng: seededRng(3) });
    expect(result.matches).toBe(result.matched.length);
    for (const n of result.matched) {
      expect(result.drawn).toContain(n);
      expect([1, 2, 3, 4, 5]).toContain(n);
    }
  });

  test("a losing round returns net equal to -bet", () => {
    let result;
    for (let seed = 1; seed < 200; seed++) {
      const candidate = resolveKeno({ spots: [1], bet: 500, rng: seededRng(seed) });
      if (candidate.matches === 0) { result = candidate; break; }
    }
    expect(result).toBeDefined();
    expect(result.multiplier).toBe(0);
    expect(result.payout).toBe(0);
    expect(result.net).toBe(-500);
    expect(result.outcome).toBe("loss");
  });

  test("classifies a stake-back round as a push", () => {
    let result;
    for (let seed = 1; seed < 500; seed++) {
      const candidate = resolveKeno({ spots: [1, 2], bet: 100, rng: seededRng(seed) });
      if (candidate.matches === 1) { result = candidate; break; }
    }
    expect(result).toBeDefined();
    expect(result.multiplier).toBe(1);
    expect(result.payout).toBe(100);
    expect(result.net).toBe(0);
    expect(result.outcome).toBe("push");
  });

  test("a full hit on a ten-spot pays the top multiplier", () => {
    const rng = seededRng(11);
    const drawn = drawNumbers(rng);
    const spots = drawn.slice(0, 10);
    const result = resolveKeno({ spots, bet: 1000, rng: seededRng(11) });
    expect(result.matches).toBe(10);
    expect(result.multiplier).toBe(getMultiplier(10, 10));
    expect(result.payout).toBe(1000 * getMultiplier(10, 10));
    expect(result.outcome).toBe("win");
  });
});
