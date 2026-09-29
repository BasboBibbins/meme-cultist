const { dayKey, monthKey, daysInMonth, daysLeftInMonth, endOfUtcDay, dailyLimit, evaluateBudget, parseMonthlyRemaining, projectMonth } = require("../../utils/webSearchBudget/logic");
const { CODES, isControlSignal, isReportableFailure } = require("../../utils/toolErrors");

const OCT_1 = Date.UTC(2026, 9, 1, 12);
const OCT_31 = Date.UTC(2026, 9, 31, 12);
const base = { monthlyBudget: 900, pacingFactor: 2, dailyFloor: 10 };

describe("calendar helpers", () => {
  test("keys are UTC", () => {
    expect(dayKey(Date.UTC(2026, 8, 30, 23, 59))).toBe("2026-09-30");
    expect(dayKey(Date.UTC(2026, 9, 1, 0, 0))).toBe("2026-10-01");
    expect(monthKey(OCT_1)).toBe("2026-10");
  });

  test("days left counts today", () => {
    expect(daysInMonth(OCT_1)).toBe(31);
    expect(daysLeftInMonth(OCT_1)).toBe(31);
    expect(daysLeftInMonth(OCT_31)).toBe(1);
  });

  test("end of day is the next UTC midnight", () => {
    expect(endOfUtcDay(OCT_1)).toBe(Date.UTC(2026, 9, 2));
  });
});

describe("dailyLimit", () => {
  test("a fresh month allows twice an even share", () => {
    expect(dailyLimit({ ...base, monthUsed: 0, dayUsed: 0, now: OCT_1 })).toBe(58);
  });

  test("spending today does not shrink today's limit", () => {
    expect(dailyLimit({ ...base, monthUsed: 40, dayUsed: 40, now: OCT_1 })).toBe(58);
  });

  test("a quiet start leaves more for later days", () => {
    const quiet = dailyLimit({ ...base, monthUsed: 50, dayUsed: 0, now: Date.UTC(2026, 9, 16) });
    const busy = dailyLimit({ ...base, monthUsed: 600, dayUsed: 0, now: Date.UTC(2026, 9, 16) });
    expect(quiet).toBeGreaterThan(busy);
  });

  test("never drops below the floor", () => {
    expect(dailyLimit({ ...base, monthUsed: 899, dayUsed: 0, now: OCT_1 })).toBe(10);
  });
});

describe("evaluateBudget", () => {
  const at = (overrides) => evaluateBudget({ ...base, monthUsed: 0, dayUsed: 0, now: OCT_1, ...overrides });

  test("allows inside every limit", () => {
    expect(at({}).allowed).toBe(true);
  });

  test("stops at the daily limit", () => {
    expect(at({ monthUsed: 58, dayUsed: 58 })).toMatchObject({ allowed: false, reason: "daily" });
  });

  test("the monthly budget beats the daily floor", () => {
    expect(at({ monthUsed: 900, dayUsed: 0, now: OCT_31 })).toMatchObject({ allowed: false, reason: "monthly" });
  });

  test("a provider refusal holds until it expires", () => {
    expect(at({ blockedUntil: OCT_1 + 1 })).toMatchObject({ allowed: false, reason: "provider" });
    expect(at({ blockedUntil: OCT_1 - 1 }).allowed).toBe(true);
  });

  test("can never exceed the monthly budget across a whole month", () => {
    let monthUsed = 0;
    for (let day = 1; day <= 31; day++) {
      const now = Date.UTC(2026, 9, day, 12);
      let dayUsed = 0;
      while (evaluateBudget({ ...base, monthUsed, dayUsed, now }).allowed) {
        dayUsed++;
        monthUsed++;
      }
    }
    expect(monthUsed).toBe(900);
  });
});

describe("parseMonthlyRemaining", () => {
  test("takes the monthly value from a per-second, per-month pair", () => {
    expect(parseMonthlyRemaining("1, 842")).toBe(842);
  });

  test("ignores missing or single-window headers", () => {
    expect(parseMonthlyRemaining(null)).toBeNull();
    expect(parseMonthlyRemaining("1")).toBeNull();
    expect(parseMonthlyRemaining("1, abc")).toBeNull();
  });
});

describe("projectMonth", () => {
  test("extrapolates the month-to-date pace", () => {
    expect(projectMonth(50, Date.UTC(2026, 9, 10))).toBe(155);
  });
});

describe("search budget control signal", () => {
  test("steers the model without reaching the user", () => {
    const signal = { error: "Web search is not available right now.", error_code: CODES.SEARCH_BUDGET_EXHAUSTED };
    expect(isControlSignal(signal)).toBe(true);
    expect(isReportableFailure(signal)).toBe(false);
  });
});
