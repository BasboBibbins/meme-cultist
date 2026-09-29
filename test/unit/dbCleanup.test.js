const { isPlayerRow, holdings, effectiveLastActive, isLongInactive, planCleanup, splitPot } = require("../../utils/dbCleanup");

const DAY = 86400000;
const NOW = new Date(2026, 8, 29, 12).getTime();

const player = (overrides = {}) => ({ name: "p", balance: 0, bank: 0, cooldowns: {}, stats: { commands: {} }, ...overrides });
const lastUsed = (ms) => ({ lastCommand: { name: "daily", at: ms }, commands: {} });

describe("isPlayerRow", () => {
  test("requires a bank field", () => {
    expect(isPlayerRow(player())).toBe(true);
    expect(isPlayerRow({ chatbot: { facts: [] } })).toBe(false);
    expect(isPlayerRow(null)).toBe(false);
  });
});

describe("holdings", () => {
  test("sums wallet and bank, ignoring debt", () => {
    expect(holdings({ balance: 50, bank: 200 })).toBe(250);
    expect(holdings({ balance: -500, bank: 200 })).toBe(200);
    expect(holdings({})).toBe(0);
  });
});

describe("effectiveLastActive", () => {
  test("yearly counters prove activity since Jan 1 of the current year", () => {
    const user = player({ stats: { commands: { yearlyReset: "2026", yearly: { slots: 3 } } } });
    expect(effectiveLastActive(user, NOW)).toBe(new Date(2026, 0, 1).getTime());
  });

  test("stale or empty yearly counters prove nothing", () => {
    expect(effectiveLastActive(player({ stats: { commands: { yearlyReset: "2025", yearly: { slots: 3 } } } }), NOW)).toBe(0);
    expect(effectiveLastActive(player({ stats: { commands: { yearlyReset: "2026", yearly: {} } } }), NOW)).toBe(0);
  });

  test("a recorded command wins when newer", () => {
    const user = player({ stats: { ...lastUsed(NOW - DAY), commands: { yearlyReset: "2026", yearly: { daily: 1 } } } });
    expect(effectiveLastActive(user, NOW)).toBe(NOW - DAY);
  });
});

describe("isLongInactive", () => {
  test("never played is inactive", () => {
    expect(isLongInactive(player(), NOW, 365)).toBe(true);
  });

  test("played this calendar year is not inactive for a year cutoff", () => {
    const user = player({ stats: { commands: { yearlyReset: "2026", yearly: { race: 1 } } } });
    expect(isLongInactive(user, NOW, 365)).toBe(false);
  });

  test("honours the cutoff on the recorded command", () => {
    expect(isLongInactive(player({ stats: lastUsed(NOW - 364 * DAY) }), NOW, 365)).toBe(false);
    expect(isLongInactive(player({ stats: lastUsed(NOW - 366 * DAY) }), NOW, 365)).toBe(true);
  });
});

describe("planCleanup", () => {
  const rows = [
    { id: "gone", value: player({ name: "gone", bank: 1000 }) },
    { id: "gonePartial", value: { chatbot: {} } },
    { id: "idle", value: player({ name: "idle", bank: 5000, balance: 20 }) },
    { id: "idleBroke", value: player({ name: "idleBroke" }) },
    { id: "active", value: player({ name: "active", bank: 10, stats: lastUsed(NOW - DAY) }) },
    { id: "lapsed", value: player({ name: "lapsed", bank: 10, stats: lastUsed(NOW - 30 * DAY) }) },
    { id: "bot", value: player({ name: "bot", stats: lastUsed(NOW - DAY) }) },
    { id: "chatOnly", value: { chatbot: {} } },
  ];
  const memberIds = new Set(["idle", "idleBroke", "active", "lapsed", "bot", "chatOnly"]);
  const plan = planCleanup(rows, { memberIds, botIds: new Set(["bot"]), now: NOW, inactiveDays: 365, activeDays: 7 });

  test("departed rows are collected, partial ones included", () => {
    expect(plan.departed.map(e => e.id)).toEqual(["gone", "gonePartial"]);
    expect(plan.departed[1].amount).toBe(0);
  });

  test("only inactive members holding koku are listed", () => {
    expect(plan.inactive).toEqual([{ id: "idle", name: "idle", amount: 5020 }]);
  });

  test("recipients are recently active humans", () => {
    expect(plan.recipients).toEqual(["active"]);
  });

  test("total covers departed and inactive", () => {
    expect(plan.total).toBe(6020);
  });
});

describe("splitPot", () => {
  test("splits by share, remainder to the jackpot", () => {
    expect(splitPot(1000, 3, 0.5)).toEqual({ jackpot: 502, perRecipient: 166 });
  });

  test("all to the jackpot with no recipients", () => {
    expect(splitPot(1000, 0, 0.5)).toEqual({ jackpot: 1000, perRecipient: 0 });
  });

  test("nothing to split", () => {
    expect(splitPot(0, 5, 0.5)).toEqual({ jackpot: 0, perRecipient: 0 });
  });

  test("never pays out more than collected", () => {
    for (const [total, n] of [[167327906, 7], [7, 9], [99, 100]]) {
      const { jackpot, perRecipient } = splitPot(total, n, 0.5);
      expect(jackpot + perRecipient * n).toBe(total);
    }
  });
});
