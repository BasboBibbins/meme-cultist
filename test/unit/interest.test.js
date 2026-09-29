const { INTEREST_TIERS, DAILY_COOLDOWN, WEEKLY_COOLDOWN, ROB_COOLDOWN } = require("../../config.js");
const { computeInterest, lastActiveAt, isActive, describeTiers } = require("../../utils/interest");

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 1);

describe("computeInterest", () => {
  test("pays nothing on empty, negative, or missing banks", () => {
    expect(computeInterest(0, INTEREST_TIERS)).toBe(0);
    expect(computeInterest(-5000, INTEREST_TIERS)).toBe(0);
    expect(computeInterest(undefined, INTEREST_TIERS)).toBe(0);
  });

  test("first bracket pays the full rate", () => {
    expect(computeInterest(100, INTEREST_TIERS)).toBe(1);
    expect(computeInterest(500000, INTEREST_TIERS)).toBe(5000);
  });

  test("bracket edges are exact", () => {
    expect(computeInterest(1000000, INTEREST_TIERS)).toBe(10000);
    expect(computeInterest(10000000, INTEREST_TIERS)).toBe(55000);
    expect(computeInterest(100000000, INTEREST_TIERS)).toBe(145000);
  });

  test("each slice earns only its own rate", () => {
    expect(computeInterest(2000000, INTEREST_TIERS)).toBe(15000);
    expect(computeInterest(23077988, INTEREST_TIERS)).toBe(68077);
  });

  test("nothing above the top bracket", () => {
    expect(computeInterest(1164342011, INTEREST_TIERS)).toBe(145000);
  });

  test("floors fractional koku", () => {
    expect(computeInterest(150, INTEREST_TIERS)).toBe(1);
  });

  test("never pays more for a smaller bank", () => {
    let previous = 0;
    for (let bank = 0; bank <= 200000000; bank += 997331) {
      const paid = computeInterest(bank, INTEREST_TIERS);
      expect(paid).toBeGreaterThanOrEqual(previous);
      previous = paid;
    }
  });
});

describe("lastActiveAt", () => {
  test("prefers the recorded last command", () => {
    const user = { stats: { lastCommand: { name: "bank", at: NOW - DAY } }, cooldowns: { daily: NOW } };
    expect(lastActiveAt(user)).toBe(NOW - DAY);
  });

  test("falls back to the newest cooldown minus its duration", () => {
    const user = { cooldowns: { daily: NOW + DAILY_COOLDOWN - 3 * DAY, weekly: NOW + WEEKLY_COOLDOWN - 2 * DAY, rob: 0 } };
    expect(lastActiveAt(user)).toBe(NOW - 2 * DAY);
  });

  test("treats an unset lastCommand as missing", () => {
    const user = { stats: { lastCommand: { name: "", at: 0 } }, cooldowns: { rob: NOW + ROB_COOLDOWN } };
    expect(lastActiveAt(user)).toBe(NOW);
  });

  test("returns 0 with no signal at all", () => {
    expect(lastActiveAt({})).toBe(0);
    expect(lastActiveAt(undefined)).toBe(0);
  });
});

describe("isActive", () => {
  const at = (ms) => ({ stats: { lastCommand: { name: "daily", at: ms } } });

  test("active inside the window, inclusive of the edge", () => {
    expect(isActive(at(NOW - DAY), NOW, 7)).toBe(true);
    expect(isActive(at(NOW - 7 * DAY), NOW, 7)).toBe(true);
  });

  test("inactive past the window", () => {
    expect(isActive(at(NOW - 7 * DAY - 1), NOW, 7)).toBe(false);
  });

  test("never active with no signal", () => {
    expect(isActive({ cooldowns: { daily: 0, weekly: 0 } }, NOW, 7)).toBe(false);
  });
});

describe("describeTiers", () => {
  test("renders every bracket", () => {
    expect(describeTiers(INTEREST_TIERS)).toBe(
      "1% on the first 1,000,000, 0.5% from 1,000,000 up to 10,000,000, 0.1% from 10,000,000 up to 100,000,000, 0% on everything above 100,000,000"
    );
  });
});
