const {
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

// Discord renders emoji at roughly two monospace cells, so column alignment
// depends on grapheme width rather than string length.
// eslint-disable-next-line no-multiline-comments
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

function cellWidth(line) {
  return [...segmenter.segment(line)].reduce(
    (width, g) => width + (/\p{Extended_Pictographic}/u.test(g.segment) ? 2 : 1),
    0
  );
}

// The narrowest Discord mobile client fits roughly this many monospace cells
// before a code block starts scrolling horizontally.
// eslint-disable-next-line no-multiline-comments
const MOBILE_CELL_BUDGET = 42;

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

// Alignment is only promised up to the odds column. Anything trailing it is
// allowed to be ragged, which is why the rank marker lives there.
// eslint-disable-next-line no-multiline-comments
function alignedWidth(line) {
  const match = line.match(/\d+(\.\d+)?x/);
  return cellWidth(line.slice(0, match.index + match[0].length));
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
      expect(line).toMatch(/\d+(\.\d+)?x {2}(🥇 1st|🥈 2nd|🥉 3rd)$/u);
    }
    for (const line of lanes) {
      expect(line).toMatch(/^\d \|/);
    }
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
