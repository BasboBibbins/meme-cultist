const { TRICK_OR_TREAT_MIN, TRICK_OR_TREAT_MAX, TRICK_OR_TREAT_WEALTH_BONUS_MAX, TRICK_OR_TREAT_WEALTH_CAP, TRICK_OR_TREAT_TRICK_CHANCE, TRICK_OR_TREAT_THEFT_RATE } = require("../../config.js");
const { isEventActive, nextOpeningEpoch, nextUtcMidnightMs, canClaim, wealthBonus, rollTreat, TRICKS, isTrick, pickTrick, theftSplit, customEmojiId, normalizeCombos, pickCombo } = require("../../utils/trickOrTreat");
const { windowStartEpoch } = require("../../utils/seasonal");

const utc = (y, m, d, h = 0) => new Date(Date.UTC(y, m - 1, d, h));
const epoch = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 1000);

describe("isEventActive", () => {
  test("open for all of October", () => {
    expect(isEventActive(utc(2026, 10, 1))).toBe(true);
    expect(isEventActive(utc(2026, 10, 31, 23))).toBe(true);
  });

  test("closed either side of October", () => {
    expect(isEventActive(utc(2026, 9, 30, 23))).toBe(false);
    expect(isEventActive(utc(2026, 11, 1))).toBe(false);
  });

  test("recurs in later years", () => {
    expect(isEventActive(utc(2031, 10, 15))).toBe(true);
  });
});

describe("nextOpeningEpoch", () => {
  test("points at this October before the window", () => {
    expect(nextOpeningEpoch(utc(2026, 9, 28))).toBe(epoch(2026, 10, 1));
  });

  test("points at next October after the window", () => {
    expect(nextOpeningEpoch(utc(2026, 11, 1))).toBe(epoch(2027, 10, 1));
  });
});

describe("windowStartEpoch", () => {
  test("picks the soonest of several ranges", () => {
    const multi = [
      { start: { month: 3, day: 9 }, end: { month: 3, day: 17 } },
      { start: { month: 8, day: 31 }, end: { month: 9, day: 7 } },
    ];
    expect(windowStartEpoch(multi, utc(2026, 6, 1))).toBe(epoch(2026, 8, 31));
    expect(windowStartEpoch(multi, utc(2026, 10, 1))).toBe(epoch(2027, 3, 9));
  });

  test("returns null once a one-time window has passed", () => {
    const oneTime = { start: { month: 4, day: 20, year: 2026 }, end: { month: 4, day: 30, year: 2026 } };
    expect(windowStartEpoch(oneTime, utc(2026, 5, 1))).toBeNull();
    expect(windowStartEpoch(oneTime, utc(2026, 1, 1))).toBe(epoch(2026, 4, 20));
  });

  test("returns null for no availability", () => {
    expect(windowStartEpoch(null, utc(2026, 5, 1))).toBeNull();
  });
});

describe("nextUtcMidnightMs", () => {
  test("rolls to the next calendar day", () => {
    expect(nextUtcMidnightMs(utc(2026, 10, 5, 13))).toBe(Date.UTC(2026, 9, 6));
  });

  test("a claim just after midnight still waits a full day", () => {
    expect(nextUtcMidnightMs(utc(2026, 10, 5, 0))).toBe(Date.UTC(2026, 9, 6));
  });

  test("rolls across the month end", () => {
    expect(nextUtcMidnightMs(utc(2026, 10, 31, 22))).toBe(Date.UTC(2026, 10, 1));
  });
});

describe("canClaim", () => {
  test("allows a user who has never claimed", () => {
    expect(canClaim(0, Date.UTC(2026, 9, 5))).toBe(true);
    expect(canClaim(undefined, Date.UTC(2026, 9, 5))).toBe(true);
  });

  test("blocks until the reset, then allows", () => {
    const resetAt = Date.UTC(2026, 9, 6);
    expect(canClaim(resetAt, resetAt - 1, false)).toBe(false);
    expect(canClaim(resetAt, resetAt, false)).toBe(true);
  });

  test("force active ignores the cooldown", () => {
    const resetAt = Date.UTC(2026, 9, 6);
    expect(canClaim(resetAt, resetAt - 1, true)).toBe(true);
  });
});

describe("wealthBonus", () => {
  test("is largest at an empty bank", () => {
    expect(wealthBonus(0)).toBe(TRICK_OR_TREAT_WEALTH_BONUS_MAX);
  });

  test("fades logarithmically", () => {
    expect(wealthBonus(1000)).toBe(343);
    expect(wealthBonus(10000)).toBe(257);
    expect(wealthBonus(100000)).toBe(171);
    expect(wealthBonus(1000000)).toBe(86);
  });

  test("is zero at and above the cap", () => {
    expect(wealthBonus(TRICK_OR_TREAT_WEALTH_CAP)).toBe(0);
    expect(wealthBonus(TRICK_OR_TREAT_WEALTH_CAP * 1000)).toBe(0);
  });

  test("never decreases as the bank shrinks", () => {
    let previous = -1;
    for (let bank = TRICK_OR_TREAT_WEALTH_CAP; bank >= 1; bank = Math.floor(bank / 3)) {
      const bonus = wealthBonus(bank);
      expect(bonus).toBeGreaterThanOrEqual(previous);
      previous = bonus;
    }
  });

  test("treats negative or missing banks as empty", () => {
    expect(wealthBonus(-500)).toBe(TRICK_OR_TREAT_WEALTH_BONUS_MAX);
    expect(wealthBonus(undefined)).toBe(TRICK_OR_TREAT_WEALTH_BONUS_MAX);
    expect(wealthBonus(NaN)).toBe(TRICK_OR_TREAT_WEALTH_BONUS_MAX);
  });
});

describe("rollTreat", () => {
  test("base spans the configured range inclusively", () => {
    expect(rollTreat(TRICK_OR_TREAT_WEALTH_CAP, () => 0).amount).toBe(TRICK_OR_TREAT_MIN);
    expect(rollTreat(TRICK_OR_TREAT_WEALTH_CAP, () => 0.999999).amount).toBe(TRICK_OR_TREAT_MAX);
  });

  test("adds the bank bonus on top of the base", () => {
    const treat = rollTreat(0, () => 0);
    expect(treat).toEqual({ base: TRICK_OR_TREAT_MIN, bonus: TRICK_OR_TREAT_WEALTH_BONUS_MAX, amount: TRICK_OR_TREAT_MIN + TRICK_OR_TREAT_WEALTH_BONUS_MAX });
  });

  test("always lands inside the base range plus the bonus", () => {
    for (let i = 0; i < 1000; i++) {
      const { amount, bonus } = rollTreat(10000);
      expect(amount).toBeGreaterThanOrEqual(TRICK_OR_TREAT_MIN + bonus);
      expect(amount).toBeLessThanOrEqual(TRICK_OR_TREAT_MAX + bonus);
      expect(Number.isInteger(amount)).toBe(true);
    }
  });
});

const sequence = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};
const tierOf = id => TRICKS.find(t => t.id === id).tier;

describe("isTrick", () => {
  test("fires below the configured chance only", () => {
    expect(isTrick(() => 0)).toBe(true);
    expect(isTrick(() => TRICK_OR_TREAT_TRICK_CHANCE - 0.0001)).toBe(true);
    expect(isTrick(() => TRICK_OR_TREAT_TRICK_CHANCE)).toBe(false);
  });
});

describe("TRICKS", () => {
  test("weights split 70 mild, 20 medium, 10 severe", () => {
    const byTier = tier => TRICKS.filter(t => t.tier === tier).reduce((sum, t) => sum + t.weight, 0);
    expect(byTier("mild")).toBe(70);
    expect(byTier("medium")).toBe(20);
    expect(byTier("severe")).toBe(10);
  });
});

describe("pickTrick", () => {
  const all = () => true;

  test("walks the weight table in order", () => {
    expect(pickTrick(all, () => 0)).toBe("noTreat");
    expect(pickTrick(all, () => 0.5)).toBe("theft");
    expect(pickTrick(all, () => 0.75)).toBe("possessed");
    expect(pickTrick(all, () => 0.85)).toBe("impersonation");
    expect(pickTrick(all, () => 0.92)).toBe("spooked");
    expect(pickTrick(all, () => 0.99)).toBe("timeout");
  });

  test("rerolls within the same tier when the pick cannot apply", () => {
    expect(pickTrick(id => id !== "spooked", sequence(0.92, 0))).toBe("timeout");
    expect(pickTrick(id => id !== "timeout", sequence(0.99, 0.99))).toBe("spooked");
  });

  test("falls to a mild trick when the whole tier cannot apply", () => {
    const noSevere = id => tierOf(id) !== "severe";
    for (let i = 0; i < 50; i++) {
      expect(tierOf(pickTrick(noSevere, sequence(0.99, Math.random())))).toBe("mild");
    }
  });

  test("lands on no treat when nothing else can apply", () => {
    expect(pickTrick(id => id === "noTreat", sequence(0.99, 0.5))).toBe("noTreat");
    expect(pickTrick(id => id === "noTreat", sequence(0.5, 0.5))).toBe("noTreat");
  });

  test("never returns a trick that cannot apply", () => {
    const allowed = new Set(["noTreat", "possessed"]);
    for (let i = 0; i < 500; i++) {
      expect(allowed.has(pickTrick(id => allowed.has(id)))).toBe(true);
    }
  });
});

describe("theftSplit", () => {
  test("takes the configured share of wallet plus bank", () => {
    expect(theftSplit(100000, 900000).amount).toBe(Math.floor(1000000 * TRICK_OR_TREAT_THEFT_RATE));
  });

  test("drains the wallet before the bank", () => {
    const amount = Math.floor(1000000 * TRICK_OR_TREAT_THEFT_RATE);
    expect(theftSplit(amount + 10, 1000000 - amount - 10)).toEqual({ amount, fromWallet: amount, fromBank: 0 });
    expect(theftSplit(1000, 999000)).toEqual({ amount, fromWallet: 1000, fromBank: amount - 1000 });
    expect(theftSplit(0, 1000000)).toEqual({ amount, fromWallet: 0, fromBank: amount });
  });

  test("never takes more than the user has, or goes negative", () => {
    expect(theftSplit(0, 0)).toEqual({ amount: 0, fromWallet: 0, fromBank: 0 });
    expect(theftSplit(-500, 100)).toEqual({ amount: 0, fromWallet: 0, fromBank: 0 });
    expect(theftSplit(undefined, NaN)).toEqual({ amount: 0, fromWallet: 0, fromBank: 0 });
  });
});

describe("customEmojiId", () => {
  test("reads static and animated custom emojis", () => {
    expect(customEmojiId("<:pepeghost:123456789012345678>")).toBe("123456789012345678");
    expect(customEmojiId("<a:spinpumpkin:123456789012345678>")).toBe("123456789012345678");
  });

  test("returns null for unicode and malformed input", () => {
    expect(customEmojiId("🎃")).toBeNull();
    expect(customEmojiId("🧛‍♂️")).toBeNull();
    expect(customEmojiId(":pepeghost:")).toBeNull();
    expect(customEmojiId("<:x:123456789012345678>")).toBeNull();
  });
});

describe("normalizeCombos", () => {
  test("keeps unicode, multi-codepoint, and custom emojis", () => {
    const combo = ["🎃", "🧛‍♂️", "🇧", "<:pepeghost:123456789012345678>"];
    expect(normalizeCombos([combo])).toEqual([combo]);
  });

  test("drops duplicates within a combo, since Discord rejects a repeat reaction", () => {
    expect(normalizeCombos([["👻", "🎃", "👻"]])).toEqual([["👻", "🎃"]]);
  });

  test("drops blanks, non-strings, empty combos, and non-array entries", () => {
    expect(normalizeCombos([[" 🎃 ", "", 5, null], [], "👻", null])).toEqual([["🎃"]]);
    expect(normalizeCombos(undefined)).toEqual([]);
  });

  test("caps a combo at Discord's 20 reactions", () => {
    const many = Array.from({ length: 25 }, (_, i) => `<:e${i}:1234567890123456${String(i).padStart(2, "0")}>`);
    expect(normalizeCombos([many])[0]).toHaveLength(20);
  });

  test("every configured combo survives normalization intact", () => {
    const { TRICK_OR_TREAT_POSSESSED_COMBOS } = require("../../config.js");
    expect(normalizeCombos(TRICK_OR_TREAT_POSSESSED_COMBOS)).toEqual(TRICK_OR_TREAT_POSSESSED_COMBOS);
  });
});

describe("pickCombo", () => {
  const combos = [["🎃"], ["🦇", "🌕"], ["👻"]];

  test("picks across the whole pool", () => {
    expect(pickCombo(combos, () => 0)).toEqual(["🎃"]);
    expect(pickCombo(combos, () => 0.5)).toEqual(["🦇", "🌕"]);
    expect(pickCombo(combos, () => 0.999)).toEqual(["👻"]);
  });

  test("returns nothing from an empty pool", () => {
    expect(pickCombo([])).toEqual([]);
  });
});

describe("forced outcomes", () => {
  test("treat forces a treat regardless of the roll", () => {
    expect(isTrick(() => 0, "treat")).toBe(false);
  });

  test("a trick id forces a trick and picks that trick", () => {
    expect(isTrick(() => 0.99, "timeout")).toBe(true);
    expect(pickTrick(() => true, () => 0, "timeout")).toBe("timeout");
  });

  test("a forced trick that cannot apply still rerolls by the normal rules", () => {
    expect(pickTrick(id => id !== "timeout", () => 0, "timeout")).toBe("spooked");
    expect(tierOf(pickTrick(id => tierOf(id) !== "severe", () => 0, "timeout"))).toBe("mild");
  });

  test("an unknown value is ignored", () => {
    expect(isTrick(() => 0.99, "bogus")).toBe(false);
    expect(pickTrick(() => true, () => 0, "bogus")).toBe("noTreat");
  });
});
