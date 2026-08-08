const {
  normalizeAvailability,
  isThemeAvailable,
  availabilityEndEpoch,
  isOneTimeAvailability,
  formatAvailability,
} = require("../../utils/inventory");
const { getThemeList } = require("../../themes/configs/index");

const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const endOf = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d, 23, 59, 59, 999) / 1000);

const SINGLE = { start: { month: 10, day: 1 }, end: { month: 10, day: 31 } };
const MULTI = [
  { start: { month: 3, day: 9 },  end: { month: 3, day: 17 } },
  { start: { month: 8, day: 31 }, end: { month: 9, day: 7 } },
];
const ONE_TIME = { start: { month: 4, day: 20, year: 2026 }, end: { month: 4, day: 30, year: 2026 } };
const WRAP = { start: { month: 12, day: 20 }, end: { month: 1, day: 5 } };

describe("normalizeAvailability", () => {
  test("wraps a single range object into an array", () => {
    expect(normalizeAvailability(SINGLE)).toEqual([SINGLE]);
  });

  test("passes an array of ranges through", () => {
    expect(normalizeAvailability(MULTI)).toHaveLength(2);
  });

  test("returns empty for null/undefined", () => {
    expect(normalizeAvailability(null)).toEqual([]);
    expect(normalizeAvailability(undefined)).toEqual([]);
  });

  test("drops malformed ranges", () => {
    expect(normalizeAvailability([SINGLE, null, { start: { month: 1 } }])).toEqual([SINGLE]);
  });
});

describe("isThemeAvailable", () => {
  test("single-range themes keep working", () => {
    expect(isThemeAvailable(SINGLE, utc(2026, 10, 15))).toBe(true);
    expect(isThemeAvailable(SINGLE, utc(2026, 11, 1))).toBe(false);
  });

  test("is available inside either window of a multi-range theme", () => {
    expect(isThemeAvailable(MULTI, utc(2026, 3, 9))).toBe(true);
    expect(isThemeAvailable(MULTI, utc(2026, 3, 17))).toBe(true);
    expect(isThemeAvailable(MULTI, utc(2026, 8, 31))).toBe(true);
    expect(isThemeAvailable(MULTI, utc(2026, 9, 7))).toBe(true);
  });

  test("is unavailable between and outside the windows", () => {
    expect(isThemeAvailable(MULTI, utc(2026, 3, 8))).toBe(false);
    expect(isThemeAvailable(MULTI, utc(2026, 3, 18))).toBe(false);
    expect(isThemeAvailable(MULTI, utc(2026, 6, 1))).toBe(false);
    expect(isThemeAvailable(MULTI, utc(2026, 9, 8))).toBe(false);
  });

  test("recurring windows apply in any year", () => {
    expect(isThemeAvailable(MULTI, utc(2031, 3, 12))).toBe(true);
  });

  test("year-pinned windows only apply in their year", () => {
    expect(isThemeAvailable(ONE_TIME, utc(2026, 4, 25))).toBe(true);
    expect(isThemeAvailable(ONE_TIME, utc(2027, 4, 25))).toBe(false);
  });

  test("year-wrapping windows still span the new year", () => {
    expect(isThemeAvailable(WRAP, utc(2026, 12, 25))).toBe(true);
    expect(isThemeAvailable(WRAP, utc(2026, 1, 3))).toBe(true);
    expect(isThemeAvailable(WRAP, utc(2026, 6, 1))).toBe(false);
  });

  test("returns false when availability is absent", () => {
    expect(isThemeAvailable(null, utc(2026, 3, 12))).toBe(false);
  });
});

describe("availabilityEndEpoch", () => {
  test("returns the end of whichever window is currently open", () => {
    expect(availabilityEndEpoch(MULTI, utc(2026, 3, 12))).toBe(endOf(2026, 3, 17));
    expect(availabilityEndEpoch(MULTI, utc(2026, 9, 2))).toBe(endOf(2026, 9, 7));
  });

  test("returns null when no window is open", () => {
    expect(availabilityEndEpoch(MULTI, utc(2026, 6, 1))).toBeNull();
    expect(availabilityEndEpoch(null, utc(2026, 6, 1))).toBeNull();
  });

  test("bumps a year-wrapping window to next year while in its head", () => {
    expect(availabilityEndEpoch(WRAP, utc(2026, 12, 25))).toBe(endOf(2027, 1, 5));
    expect(availabilityEndEpoch(WRAP, utc(2026, 1, 3))).toBe(endOf(2026, 1, 5));
  });

  test("takes the latest close when ranges overlap", () => {
    const overlapping = [
      { start: { month: 5, day: 1 }, end: { month: 5, day: 10 } },
      { start: { month: 5, day: 5 }, end: { month: 5, day: 20 } },
    ];
    expect(availabilityEndEpoch(overlapping, utc(2026, 5, 6))).toBe(endOf(2026, 5, 20));
  });
});

describe("isOneTimeAvailability", () => {
  test("true when every range is year-pinned", () => {
    expect(isOneTimeAvailability(ONE_TIME)).toBe(true);
    expect(isOneTimeAvailability([ONE_TIME, ONE_TIME])).toBe(true);
  });

  test("false for recurring ranges", () => {
    expect(isOneTimeAvailability(SINGLE)).toBe(false);
    expect(isOneTimeAvailability(MULTI)).toBe(false);
  });

  test("false when any range recurs, since the theme still comes back", () => {
    expect(isOneTimeAvailability([ONE_TIME, ...MULTI])).toBe(false);
  });

  test("false when availability is absent", () => {
    expect(isOneTimeAvailability(null)).toBe(false);
  });
});

describe("formatAvailability", () => {
  test("formats a single recurring range", () => {
    expect(formatAvailability(SINGLE)).toBe("Oct 1 - Oct 31 (yearly)");
  });

  test("formats a year-pinned range with its year and no yearly suffix", () => {
    expect(formatAvailability(ONE_TIME)).toBe("Apr 20 - Apr 30, 2026");
  });

  test("joins multiple ranges with one trailing yearly suffix", () => {
    expect(formatAvailability(MULTI)).toBe("Mar 9 - Mar 17, Aug 31 - Sep 7 (yearly)");
  });

  test("orders ranges by calendar date regardless of declaration order", () => {
    expect(formatAvailability([MULTI[1], MULTI[0]]))
      .toBe("Mar 9 - Mar 17, Aug 31 - Sep 7 (yearly)");
  });

  test("returns empty string when availability is absent", () => {
    expect(formatAvailability(null)).toBe("");
  });
});

describe("mikuDay theme config", () => {
  const mikuDay = getThemeList().find(t => t.id === "mikuDay");

  test("declares both the 3/9 and 8/31 windows", () => {
    expect(normalizeAvailability(mikuDay.availability)).toHaveLength(2);
    expect(isThemeAvailable(mikuDay.availability, utc(2026, 3, 12))).toBe(true);
    expect(isThemeAvailable(mikuDay.availability, utc(2026, 9, 1))).toBe(true);
    expect(isThemeAvailable(mikuDay.availability, utc(2026, 5, 1))).toBe(false);
  });

  test("recurs yearly rather than being one-time", () => {
    expect(isOneTimeAvailability(mikuDay.availability)).toBe(false);
  });
});
