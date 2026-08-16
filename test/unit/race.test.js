const {
  advanceRace,
  buildTrack,
  buildRaceDescription,
  buildBettingDescription,
  generateHorses,
  determineTopThree,
  summarizeBettors,
  buildResultsSection,
  fitDescription,
  escapeMarkdown,
} = require("../../utils/race");

// Emoji render at roughly two monospace cells.
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

function cellWidth(line) {
  return [...segmenter.segment(line)].reduce(
    (width, g) => width + (/\p{Extended_Pictographic}/u.test(g.segment) ? 2 : 1),
    0
  );
}

// Cells the narrowest mobile client fits before a code block scrolls.
const MOBILE_CELL_BUDGET = 42;
const FLAG = "🏁";

function makeHorses() {
  const horses = generateHorses();
  horses[0].name = "Definitely-Not-A Accountant";
  horses[1].name = "Aggressively Horoscope";
  const odds = [25, 1.1, 14.6, 3.2, 9.75, 1.4, 22.5, 6];
  horses.forEach((h, i) => { h.displayOdds = odds[i]; });
  return horses;
}

function trackLines(description) {
  return description.split("\n").filter(line => line.includes("|"));
}

// Alignment is only promised up to the finish flag; tags trail it.
function alignedWidth(line) {
  return cellWidth(line.slice(0, line.indexOf("🏁") + 2));
}

describe("buildTrack", () => {
  test("occupies the same width at every progress value", () => {
    const widths = [0, 1, 25, 50, 99, 100].map(p => cellWidth(buildTrack(p, "🐎")));
    expect(new Set(widths).size).toBe(1);
  });

  test("keeps the horse inside the rails at both extremes", () => {
    expect(buildTrack(0, "🐎").startsWith("|🐎")).toBe(true);
    expect(buildTrack(100, "🐎")).toContain("🐎|");
  });

  test("respects a custom track length", () => {
    expect(cellWidth(buildTrack(50, "🐎", 10))).toBeLessThan(cellWidth(buildTrack(50, "🐎", 20)));
  });
});

describe("buildRaceDescription", () => {
  const horses = makeHorses();
  const topThree = determineTopThree(horses);

  test("aligns every lane mid race", () => {
    const positions = [0, 12, 35, 48, 60, 77, 90, 100];
    const widths = trackLines(buildRaceDescription(horses, positions, 5, 10, null, [7], topThree)).map(alignedWidth);
    expect(widths).toHaveLength(8);
    expect(new Set(widths).size).toBe(1);
  });

  test("aligns every lane at the finish, where ranks appear", () => {
    const positions = new Array(8).fill(100);
    const description = buildRaceDescription(horses, positions, 10, 10, topThree.firstIndex, topThree.finishOrder);
    const widths = trackLines(description).map(alignedWidth);
    expect(new Set(widths).size).toBe(1);
  });

  test("shows a medal beside each podium rank", () => {
    const positions = new Array(8).fill(100);
    const description = buildRaceDescription(horses, positions, 10, 10, topThree.firstIndex, topThree.finishOrder);
    expect(description).toContain("🥇 1st");
    expect(description).toContain("🥈 2nd");
    expect(description).toContain("🥉 3rd");
  });

  test("keeps the rank marker clear of every aligned column", () => {
    const positions = new Array(8).fill(100);
    const lanes = trackLines(buildRaceDescription(horses, positions, 10, 10, topThree.firstIndex, topThree.finishOrder));
    const ranked = lanes.filter(line => /\d(st|nd|rd)/.test(line));
    expect(ranked).toHaveLength(3);
    expect(lanes.filter(line => !/\d(st|nd|rd)/.test(line))).toHaveLength(5);

    for (const line of ranked) {
      expect(line).toMatch(/🏁 {2}(🥇 1st|🥈 2nd|🥉 3rd)$/u);
    }
    for (const line of lanes) {
      expect(line).toMatch(/^\d \|/);
    }
  });

  function animate(totalTicks) {
    const field = generateHorses();
    const order = determineTopThree(field);
    const positions = new Array(8).fill(0);
    const crossed = [];
    const frames = [];
    for (let tick = 1; tick <= totalTicks; tick++) {
      const { newFinishers } = advanceRace(field, positions, order, tick, totalTicks);
      for (const i of newFinishers) if (!crossed.includes(i)) crossed.push(i);
      frames.push(buildRaceDescription(field, positions, tick, totalTicks, null, crossed, order));
    }
    return { field, order, frames };
  }

  const medalsIn = frame => ["🥇 1st", "🥈 2nd", "🥉 3rd"].filter(m => frame.includes(m));

  test("reveals each podium place as its horse crosses the line", () => {
    const { frames } = animate(15);
    const settle = 15 - Math.max(2, Math.round(15 * 0.2));
    frames.forEach((frame, index) => {
      const lap = index + 1;
      const expected = lap < settle ? 0 : Math.min(3, lap - settle + 1);
      expect(medalsIn(frame)).toHaveLength(expected);
    });
  });

  test("marks all three podium places on the closing frame", () => {
    const { frames } = animate(15);
    expect(medalsIn(frames[frames.length - 1])).toHaveLength(3);
  });

  test("marks the true podium rather than whoever happens to be at the line", () => {
    const { field, order, frames } = animate(15);
    const closing = frames[frames.length - 1];
    const marked = ["🥇 1st", "🥈 2nd", "🥉 3rd"].map(medal => {
      const line = trackLines(closing).find(l => l.endsWith(medal));
      return Number(line.trim()[0]);
    });
    expect(marked).toEqual(order.finishOrder.slice(0, 3).map(i => field[i].number));
  });

  test("says the race is finished once the whole field is at the line", () => {
    const { frames } = animate(15);
    expect(frames[frames.length - 1]).toContain("RACE FINISHED");
    expect(frames[frames.length - 2]).toContain("RACE IN PROGRESS");
  });

  test("tags each backed lane with its bettor", () => {
    const bets = [
      { userId: "1", username: "basbo", horseIndex: 2, amount: 10, betType: "win" },
      { userId: "2", username: "averyverylongname", horseIndex: 5, amount: 10, betType: "win" },
      { userId: "3", username: "second", horseIndex: 5, amount: 10, betType: "win" },
    ];
    const lanes = trackLines(buildRaceDescription(horses, new Array(8).fill(40), 3, 15, null, [], topThree, bets));
    expect(lanes.filter(line => !line.trim().endsWith(FLAG))).toHaveLength(2);
    expect(lanes.some(line => line.endsWith("basbo"))).toBe(true);
    expect(lanes.some(line => line.endsWith("aver\u2026 +1"))).toBe(true);
  });

  test("leaves unbacked lanes untagged", () => {
    const lanes = trackLines(buildRaceDescription(horses, new Array(8).fill(40), 3, 15, null, [], topThree, []));
    for (const line of lanes) expect(line.trim().endsWith(FLAG)).toBe(true);
  });

  test("gives the podium marker the column once a horse is placed", () => {
    const bets = [{ userId: "1", username: "basbo", horseIndex: topThree.firstIndex, amount: 10, betType: "win" }];
    const lanes = trackLines(buildRaceDescription(horses, new Array(8).fill(100), 15, 15, null, topThree.finishOrder, topThree, bets));
    const winner = lanes.find(line => line.startsWith(String(horses[topThree.firstIndex].number)));
    expect(winner).toContain("1st");
    expect(winner).not.toContain("basbo");
  });

  test("keeps every lane inside the mobile budget with tags and ranks", () => {
    const bets = [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ userId: String(i), username: "abcdefghijkl", horseIndex: i, amount: 10, betType: "win" }));
    const lanes = trackLines(buildRaceDescription(horses, new Array(8).fill(100), 15, 15, null, topThree.finishOrder, topThree, bets));
    for (const line of lanes) expect(cellWidth(line)).toBeLessThanOrEqual(MOBILE_CELL_BUDGET);
  });

  test("emits no markdown, because it renders inside a code block", () => {
    const description = buildRaceDescription(horses, new Array(8).fill(50), 5, 10, null, [], topThree);
    expect(description).not.toContain("**");
  });

  test("fits the mobile cell budget", () => {
    const description = buildRaceDescription(horses, new Array(8).fill(50), 5, 10, null, [], topThree);
    for (const line of description.split("\n")) {
      expect(cellWidth(line)).toBeLessThanOrEqual(MOBILE_CELL_BUDGET);
    }
  });

  test("truncates an emoji backer tag without splitting a surrogate pair", () => {
    const bets = [{ userId: "1", username: "🐎🐎🐎🐎🐎", horseIndex: 0, amount: 10, betType: "win" }];
    const description = buildRaceDescription(horses, new Array(8).fill(50), 5, 10, null, [], topThree, bets);
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(lone.test(description)).toBe(false);
    expect(description).not.toContain("�");
  });
});

describe("buildBettingDescription", () => {
  function listedLines(horses) {
    return buildBettingDescription(horses, [], Date.now() + 20000)
      .split("\n")
      .filter(line => /^\d /.test(line));
  }

  test("never truncates a horse name", () => {
    const horses = makeHorses();
    const listed = listedLines(horses);
    expect(listed).toHaveLength(8);
    for (const horse of horses) {
      expect(listed.some(line => line.includes(horse.name))).toBe(true);
    }
    expect(listed.join("\n")).not.toContain("…");
  });

  test("aligns the odds column across every row", () => {
    const listed = listedLines(makeHorses());
    const oddsEnds = listed.map(line => {
      const match = line.match(/\d+(\.\d+)?x/);
      return cellWidth(line.slice(0, match.index + match[0].length));
    });
    expect(new Set(oddsEnds).size).toBe(1);
  });

  test("widens the block for a long name instead of clipping it", () => {
    const short = listedLines(makeHorses().map(h => ({ ...h, name: "Bolt" })));
    const long = listedLines(makeHorses());
    expect(cellWidth(long[0])).toBeGreaterThan(cellWidth(short[0]));
    expect(long[0]).toContain("Definitely-Not-A Accountant");
  });

  test("fits the mobile cell budget, longest name and widest odds included", () => {
    for (const line of listedLines(makeHorses())) {
      expect(cellWidth(line)).toBeLessThanOrEqual(MOBILE_CELL_BUDGET);
    }
  });

  test("aligns every row to one width regardless of which lane emoji it carries", () => {
    const widths = listedLines(makeHorses()).map(cellWidth);
    expect(new Set(widths).size).toBe(1);
  });

  test("clips a name that cannot fit the budget rather than overflowing the block", () => {
    const horses = makeHorses();
    horses[0].name = "A".repeat(80);
    const listed = listedLines(horses);
    for (const line of listed) {
      expect(cellWidth(line)).toBeLessThanOrEqual(MOBILE_CELL_BUDGET);
    }
    expect(listed[0]).toContain("…");
  });

  test("still reports bets and the relative start time", () => {
    const horses = makeHorses();
    const bets = [{ userId: "1", username: "someone", horseIndex: 0, amount: 500, betType: "win" }];
    const description = buildBettingDescription(horses, bets, 1700000000000);
    expect(description).toContain("Current Bets");
    expect(description).toContain("<t:1700000000:R>");
  });
});

function makeResult(userId, overrides = {}) {
  return {
    userId,
    username: `user${userId}`,
    horseIndex: 0,
    amount: 1000,
    winnings: 0,
    won: false,
    betType: "win",
    horsePosition: 5,
    ...overrides,
  };
}

describe("summarizeBettors", () => {
  test("collapses many bets by one user into a single entry", () => {
    const results = [
      makeResult("a", { amount: 100 }),
      makeResult("a", { amount: 200, won: true, winnings: 900, horsePosition: 0 }),
      makeResult("a", { amount: 300 }),
      makeResult("b", { amount: 50 }),
    ];
    const bettors = summarizeBettors(results);
    expect(bettors).toHaveLength(2);
    const a = bettors.find(x => x.userId === "a");
    expect(a.bets).toBe(3);
    expect(a.wins).toBe(1);
    expect(a.staked).toBe(600);
    expect(a.net).toBe(300);
    expect(a.only).toBeNull();
  });

  test("keeps the single bet so its horse and type can still be named", () => {
    const [entry] = summarizeBettors([makeResult("solo", { betType: "show" })]);
    expect(entry.bets).toBe(1);
    expect(entry.only.betType).toBe("show");
  });

  test("orders bettors by net, biggest winner first", () => {
    const bettors = summarizeBettors([
      makeResult("loser", { amount: 500 }),
      makeResult("winner", { amount: 100, won: true, winnings: 5000, horsePosition: 0 }),
    ]);
    expect(bettors.map(b => b.userId)).toEqual(["winner", "loser"]);
  });
});

describe("buildResultsSection", () => {
  const horses = makeHorses();

  test("caps the rendered lines and accounts for the remainder", () => {
    const results = Array.from({ length: 40 }, (_, i) => makeResult(`u${i}`, { amount: 100 }));
    const lines = buildResultsSection(summarizeBettors(results), horses, "koku");
    const bettorLines = lines.filter(l => l.includes("<@"));
    expect(bettorLines).toHaveLength(12);
    expect(lines[lines.length - 1]).toContain("28 more bettors");
    expect(lines[lines.length - 1]).toContain("2,800 koku");
  });

  test("names the horse for a single bet and the record for many", () => {
    const lines = buildResultsSection(summarizeBettors([
      makeResult("solo", { won: true, winnings: 900, horsePosition: 0 }),
      makeResult("multi", { amount: 100 }),
      makeResult("multi", { amount: 100 }),
    ]), horses, "koku");
    expect(lines.some(l => l.includes("<@solo>") && l.includes("Horse"))).toBe(true);
    expect(lines.some(l => l.includes("<@multi>") && l.includes("0/2 bets"))).toBe(true);
  });

  test("reports a break-even bettor as neither win nor loss", () => {
    const lines = buildResultsSection(summarizeBettors([
      makeResult("even", { amount: 100, won: true, winnings: 200, horsePosition: 0 }),
      makeResult("even", { amount: 100 }),
    ]), horses, "koku");
    expect(lines.some(l => l.includes("broke even"))).toBe(true);
  });

  test("returns nothing when nobody bet", () => {
    expect(buildResultsSection([], horses, "koku")).toEqual([]);
  });
});

describe("fitDescription", () => {
  test("leaves a description that already fits untouched", () => {
    const out = fitDescription(["head"], ["", "**Results:**", "a line"]);
    expect(out).toBe("head\n\n**Results:**\na line");
  });

  test("trims until it fits and says how much it dropped", () => {
    const head = ["x".repeat(3000)];
    const section = ["", "**Results:**", ...Array.from({ length: 60 }, (_, i) => `line ${i} ${"y".repeat(60)}`)];
    const out = fitDescription(head, section);
    expect(out.length).toBeLessThanOrEqual(3900);
    expect(out).toMatch(/more results? not shown/);
  });

  test("never drops the head, even when the head alone is oversized", () => {
    const head = ["z".repeat(5000)];
    const out = fitDescription(head, ["", "**Results:**", "a", "b", "c"]);
    expect(out.startsWith("z".repeat(5000))).toBe(true);
  });
});

describe("escapeMarkdown", () => {
  test("neutralises markdown in a display name", () => {
    expect(escapeMarkdown("**bold**")).toBe("\\*\\*bold\\*\\*");
    expect(escapeMarkdown("a_b~c`d|e")).toBe("a\\_b\\~c\\`d\\|e");
  });

  test("leaves an ordinary name alone", () => {
    expect(escapeMarkdown("Basbo Bibbins")).toBe("Basbo Bibbins");
  });

  test("keeps a hostile name from deforming the bets list", () => {
    const horses = makeHorses();
    const bets = [{ userId: "1", username: "**everyone**", horseIndex: 0, amount: 10, betType: "win" }];
    expect(buildBettingDescription(horses, bets, Date.now())).toContain("\\*\\*everyone\\*\\*");
  });
});

describe("advanceRace", () => {
  const SETTLE = totalTicks => totalTicks - Math.max(2, Math.round(totalTicks * 0.2));

  function runRace(totalTicks) {
    const horses = generateHorses();
    const topThree = determineTopThree(horses);
    const positions = new Array(8).fill(0);
    const crossedAt = new Map();
    const crossingOrder = [];
    const frames = [];

    for (let tick = 1; tick <= totalTicks; tick++) {
      const { newFinishers } = advanceRace(horses, positions, topThree, tick, totalTicks);
      for (const i of newFinishers) {
        if (!crossingOrder.includes(i)) {
          crossingOrder.push(i);
          crossedAt.set(i, tick);
        }
      }
      frames.push(positions.slice());
    }
    return { horses, topThree, positions, frames, crossingOrder, crossedAt };
  }

  const cellOf = p => (p >= 100 ? 20 : Math.floor((p / 100) * 20));

  test.each([5, 10, 15, 20, 35])("brings the whole field to the line by the last lap at %i ticks", totalTicks => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const { positions } = runRace(totalTicks);
      expect(positions.filter(p => p >= 100)).toHaveLength(8);
    }
  });

  test.each([5, 10, 15, 20, 35])("crosses the field in the predetermined order at %i ticks", totalTicks => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const { topThree, crossingOrder } = runRace(totalTicks);
      expect(crossingOrder).toEqual(topThree.finishOrder);
    }
  });

  test.each([5, 10, 15, 20, 35])("crosses the podium one lap at a time at %i ticks", totalTicks => {
    const settle = SETTLE(totalTicks);
    for (let attempt = 0; attempt < 30; attempt++) {
      const { topThree, crossedAt } = runRace(totalTicks);
      const podium = topThree.finishOrder.slice(0, 3).map(i => crossedAt.get(i));
      expect(podium).toEqual([settle, Math.min(settle + 1, totalTicks), Math.min(settle + 2, totalTicks)]);
    }
  });

  test("reports finishers in rank order so accumulated medals stay correct", () => {
    const horses = generateHorses();
    const topThree = determineTopThree(horses);
    const positions = new Array(8).fill(0);
    const seen = [];
    for (let tick = 1; tick <= 15; tick++) {
      const { newFinishers } = advanceRace(horses, positions, topThree, tick, 15);
      seen.push(...newFinishers);
    }
    expect(seen).toEqual(topThree.finishOrder);
  });

  test("never moves a horse backwards", () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const { frames } = runRace(15);
      for (let f = 1; f < frames.length; f++) {
        for (let i = 0; i < 8; i++) expect(frames[f][i]).toBeGreaterThanOrEqual(frames[f - 1][i]);
      }
    }
  });

  test.each([5, 10, 15, 20, 35])("never stalls a running horse for two laps at %i ticks", totalTicks => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const { frames } = runRace(totalTicks);
      for (let i = 0; i < 8; i++) {
        const lane = [0, ...frames.map(f => f[i])];
        for (let k = 2; k < lane.length; k++) {
          if (lane[k - 2] >= 100) continue;
          expect(cellOf(lane[k]) - cellOf(lane[k - 2])).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  test("keeps the field unresolved through the first half", () => {
    let earlyLeaderWasWinner = 0;
    const attempts = 200;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const horses = generateHorses();
      const topThree = determineTopThree(horses);
      const positions = new Array(8).fill(0);
      for (let tick = 1; tick <= 7; tick++) advanceRace(horses, positions, topThree, tick, 15);
      const leader = positions.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0])[0][1];
      if (leader === topThree.firstIndex) earlyLeaderWasWinner += 1;
    }
    expect(earlyLeaderWasWinner / attempts).toBeLessThan(0.45);
  });

  test("assigns every horse a pace style", () => {
    for (const style of new Set(generateHorses().map(h => h.style))) {
      expect(["front", "fader", "closer", "steady"]).toContain(style);
    }
  });

  test("still works for a caller that only carries the podium", () => {
    const horses = generateHorses();
    const topThree = determineTopThree(horses);
    const positions = new Array(8).fill(0);
    const podiumOnly = {
      firstIndex: topThree.firstIndex,
      secondIndex: topThree.secondIndex,
      thirdIndex: topThree.thirdIndex,
    };
    const crossed = [];
    for (let tick = 1; tick <= 15; tick++) {
      crossed.push(...advanceRace(horses, positions, podiumOnly, tick, 15).newFinishers);
    }
    expect(crossed.slice(0, 3)).toEqual([topThree.firstIndex, topThree.secondIndex, topThree.thirdIndex]);
    expect(positions.filter(p => p >= 100)).toHaveLength(8);
  });
});
