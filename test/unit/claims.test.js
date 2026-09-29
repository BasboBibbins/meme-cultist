const { DAILY_MIN, DAILY_MAX, DAILY_STREAK_BONUS_MIN_PER_DAY, DAILY_STREAK_BONUS_MAX_PER_DAY, WEEKLY_MIN, WEEKLY_MAX } = require("../../config.js");
const { rollRange, rollDaily, rollWeekly } = require("../../utils/claims");

const low = () => 0;
const high = () => 0.9999999;

describe("rollRange", () => {
  test("is inclusive at both ends", () => {
    expect(rollRange(10, 20, low)).toBe(10);
    expect(rollRange(10, 20, high)).toBe(20);
  });
});

describe("rollDaily", () => {
  test("base amount spans the configured range", () => {
    expect(rollDaily(1, low).amount).toBe(DAILY_MIN);
    expect(rollDaily(1, high).amount).toBe(DAILY_MAX);
  });

  test("no bonus on the first day of a streak", () => {
    expect(rollDaily(1, high).bonus).toBe(0);
  });

  test("bonus scales with the streak", () => {
    expect(rollDaily(5, low).bonus).toBe(5 * DAILY_STREAK_BONUS_MIN_PER_DAY);
    expect(rollDaily(5, high).bonus).toBe(5 * DAILY_STREAK_BONUS_MAX_PER_DAY);
  });
});

describe("rollWeekly", () => {
  test("spans the configured range", () => {
    expect(rollWeekly(low)).toBe(WEEKLY_MIN);
    expect(rollWeekly(high)).toBe(WEEKLY_MAX);
  });
});
