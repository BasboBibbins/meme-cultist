const { buildTrack, buildRaceDescription, buildBettingDescription, generateHorses, determineTopThree } = require("../../utils/race");

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
    const widths = trackLines(buildRaceDescription(horses, positions, 5, 10, null, [7], topThree)).map(cellWidth);
    expect(widths).toHaveLength(8);
    expect(new Set(widths).size).toBe(1);
  });

  test("aligns every lane at the finish, where ranks appear", () => {
    const positions = new Array(8).fill(100);
    const description = buildRaceDescription(horses, positions, 10, 10, topThree.firstIndex, topThree.finishOrder);
    const widths = trackLines(description).map(cellWidth);
    expect(new Set(widths).size).toBe(1);
  });

  test("shows a medal beside each podium rank", () => {
    const positions = new Array(8).fill(100);
    const description = buildRaceDescription(horses, positions, 10, 10, topThree.firstIndex, topThree.finishOrder);
    expect(description).toContain("🥇 1st");
    expect(description).toContain("🥈 2nd");
    expect(description).toContain("🥉 3rd");
  });

  test("pads an unranked lane to the exact width of a ranked one", () => {
    const positions = new Array(8).fill(100);
    const lanes = trackLines(buildRaceDescription(horses, positions, 10, 10, topThree.firstIndex, topThree.finishOrder));
    const ranked = lanes.filter(line => /\d(st|nd|rd)/.test(line));
    const unranked = lanes.filter(line => !/\d(st|nd|rd)/.test(line));
    expect(ranked).toHaveLength(3);
    expect(unranked).toHaveLength(5);
    const prefixWidth = line => cellWidth(line.slice(0, line.indexOf("|")));
    expect(new Set([...ranked, ...unranked].map(prefixWidth)).size).toBe(1);
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
