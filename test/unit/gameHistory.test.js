const { summarizeGameResult, formatHistoryLine, formatSigned, summarizeHistory, historySpan } = require("../../utils/gameHistory");
const { formatDuration, formatInterval } = require("../../utils/time");

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
  test("names the game, the net, and the detail", () => {
    const line = formatHistoryLine(row("keno", { bet: 100, spots: [1, 2, 3], matches: 2, net: 50 }));
    expect(line).toContain("Keno");
    expect(line).toContain("2/3 hit");
    expect(line).toContain("+50");
  });

  test("carries no per-row timestamp — the list is newest-first and the span is stated once", () => {
    const line = formatHistoryLine(row("keno", { bet: 100, spots: [1, 2, 3], matches: 2, net: 50 }));
    expect(line).not.toMatch(/<t:\d+:[A-Za-z]>/);
  });

  test("omits the wager segment when there is no stake", () => {
    const line = formatHistoryLine(row("rob", { victim_id: "42", outcome: "success", amount: 900, net: 900 }));
    expect(line).not.toContain("bet");
  });

  test("omits the wager on a total loss, where it only repeats the net", () => {
    expect(formatHistoryLine(row("keno", { bet: 500, spots: [1, 2], matches: 0, net: -500 }))).not.toContain("bet");
    expect(formatHistoryLine(row("keno", { bet: 500, spots: [1, 2], matches: 1, net: -100 }))).toContain("bet 500");
  });

  test("drops details that only restate the icon and the sign", () => {
    expect(formatHistoryLine(row("flip", { bet: 10, net: 10 }))).toBe("🟢 **Coinflip** **+10** · bet 10");
    expect(formatHistoryLine(row("blackjack", { total_bet: 10, net: -10, outcome: "loss" }))).not.toContain("loss");
    expect(formatHistoryLine(row("blackjack", { total_bet: 10, net: 0, outcome: "push" }))).toContain("push");
  });

  test("shows the other duellist, whichever side the viewer was on", () => {
    const base = { challenger_id: "AAA", opponent_id: "BBB", bet: 10 };
    const asChallenger = { game: "duel", user_id: "AAA", played_at: at, result: { ...base, net: 10 } };
    const asOpponent = { game: "duel", user_id: "BBB", played_at: at, result: { ...base, net: -10 } };
    expect(formatHistoryLine(asChallenger)).toContain("<@BBB>");
    expect(formatHistoryLine(asOpponent)).toContain("<@AAA>");
  });

  test("clips a long detail so one result cannot blow out the row", () => {
    const longName = "A Horse With A Preposterously Long Name Indeed";
    const line = formatHistoryLine(row("race", { bets: [{ amount: 1 }], net: 5, finish_order: [{ place: 1, name: longName }] }));
    expect(line).toContain("…");
    expect(line).not.toContain(longName);
  });

  test("stays inside a mobile column for a typical result", () => {
    const line = formatHistoryLine(row("roulette", { total_wagered: 1200, net: -1200, winning_number: 17, color: "black" }));
    expect(line.replace(/\*\*/g, "").length).toBeLessThanOrEqual(38);
  });
});

describe("historySpan", () => {
  test("returns the oldest and newest timestamps", () => {
    const rows = [row("flip", { bet: 1, net: 1 }), { game: "flip", played_at: at - 5000, result: { bet: 1, net: 1 } }];
    expect(historySpan(rows)).toEqual({ oldest: at - 5000, newest: at });
  });

  test("returns null when there is nothing to span", () => {
    expect(historySpan([])).toBeNull();
    expect(historySpan(null)).toBeNull();
  });
});

describe("summarizeHistory", () => {
  // Pushes are counted so the W/L/P line adds up to the number of rows shown.
  test("totals net, wagered, and the full record", () => {
    const totals = summarizeHistory([
      row("flip", { bet: 100, net: 100 }),
      row("flip", { bet: 100, net: -100 }),
      row("keno", { bet: 200, net: 0 }),
      row("rob", { outcome: "fail", net: 0 }),
    ]);
    expect(totals).toEqual({ net: 0, wagered: 400, wins: 1, losses: 1, pushes: 2 });
    expect(totals.wins + totals.losses + totals.pushes).toBe(4);
  });

  test("handles an empty history", () => {
    expect(summarizeHistory([])).toEqual({ net: 0, wagered: 0, wins: 0, losses: 0, pushes: 0 });
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

describe("formatInterval", () => {
  test("drops the count so an 'every X' sentence reads as English", () => {
    expect(formatInterval(8.64e7)).toBe("day");
    expect(formatInterval(6.048e8)).toBe("7 days");
    expect(formatInterval(300000)).toBe("5 minutes");
    expect(formatInterval(3600000)).toBe("hour");
  });

  test("leaves multi-unit durations alone", () => {
    expect(formatInterval(3660000)).toBe("1 hour 1 minute");
  });
});
