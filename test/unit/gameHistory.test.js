const { summarizeGameResult, formatHistoryLine, formatSigned, summarizeHistory } = require("../../utils/gameHistory");
const { formatDuration } = require("../../utils/time");

const at = 1754870400000;

function row(game, result) {
  return { game, played_at: at, result };
}

describe("summarizeGameResult", () => {
  test("reads the per-game wager key", () => {
    expect(summarizeGameResult(row("slots", { total_cost: 150, net: -150 })).wagered).toBe(150);
    expect(summarizeGameResult(row("blackjack", { total_bet: 200, net: 200 })).wagered).toBe(200);
    expect(summarizeGameResult(row("roulette", { total_wagered: 50, net: -50 })).wagered).toBe(50);
    expect(summarizeGameResult(row("poker", { bet: 75, net: 0 })).wagered).toBe(75);
  });

  test("sums race bets, which carry no total", () => {
    const s = summarizeGameResult(row("race", { bets: [{ amount: 100 }, { amount: 250 }], net: -350 }));
    expect(s.wagered).toBe(350);
  });

  test("reports no wager for rob, which stakes nothing", () => {
    expect(summarizeGameResult(row("rob", { amount: 900, outcome: "success", net: 900 })).wagered).toBeNull();
  });

  test("derives outcome from net, treating a duel draw as a draw", () => {
    expect(summarizeGameResult(row("flip", { bet: 10, net: 10 })).outcome).toBe("win");
    expect(summarizeGameResult(row("flip", { bet: 10, net: -10 })).outcome).toBe("loss");
    expect(summarizeGameResult(row("keno", { bet: 10, net: 0 })).outcome).toBe("push");
    expect(summarizeGameResult(row("duel", { bet: 10, outcome: "draw", net: 0 })).outcome).toBe("draw");
  });

  test("survives a missing or malformed result payload", () => {
    const s = summarizeGameResult({ game: "slots", played_at: at });
    expect(s.net).toBe(0);
    expect(s.wagered).toBeNull();
    expect(s.label).toBe("Slots");
  });

  test("falls back to the raw key for an unknown game", () => {
    expect(summarizeGameResult(row("baccarat", { net: 5 })).label).toBe("baccarat");
  });
});

describe("formatSigned", () => {
  test("signs and groups", () => {
    expect(formatSigned(1500)).toBe("+1,500");
    expect(formatSigned(-1500)).toBe("−1,500");
    expect(formatSigned(0)).toBe("±0");
  });
});

describe("formatHistoryLine", () => {
  test("renders a Discord relative timestamp, never a locale string", () => {
    const line = formatHistoryLine(row("keno", { bet: 100, spots: [1, 2, 3], matches: 2, net: 50 }));
    expect(line).toContain(`<t:${Math.floor(at / 1000)}:R>`);
    expect(line).toContain("Keno");
    expect(line).toContain("2/3 hit");
    expect(line).toContain("+50");
  });

  test("omits the wager segment when there is no stake", () => {
    const line = formatHistoryLine(row("rob", { victim_id: "42", outcome: "success", amount: 900, net: 900 }));
    expect(line).not.toContain("bet");
  });
});

describe("summarizeHistory", () => {
  test("totals net, wagered, and the win/loss record", () => {
    const totals = summarizeHistory([
      row("flip", { bet: 100, net: 100 }),
      row("flip", { bet: 100, net: -100 }),
      row("keno", { bet: 200, net: 0 }),
      row("rob", { outcome: "fail", net: 0 }),
    ]);
    expect(totals).toEqual({ net: 0, wagered: 400, wins: 1, losses: 1 });
  });

  test("handles an empty history", () => {
    expect(summarizeHistory([])).toEqual({ net: 0, wagered: 0, wins: 0, losses: 0 });
  });
});

describe("formatDuration", () => {
  test("renders the two largest units", () => {
    expect(formatDuration(8.64e7)).toBe("1 day");
    expect(formatDuration(6.048e8)).toBe("7 days");
    expect(formatDuration(300000)).toBe("5 minutes");
    expect(formatDuration(3660000)).toBe("1 hour 1 minute");
  });

  test("floors sub-second and negative input", () => {
    expect(formatDuration(0)).toBe("0 seconds");
    expect(formatDuration(-500)).toBe("0 seconds");
    expect(formatDuration(undefined)).toBe("0 seconds");
  });
});
