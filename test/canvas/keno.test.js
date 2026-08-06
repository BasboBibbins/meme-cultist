const { drawKenoResult, drawPaytable } = require("../../utils/kenoCanvas");
const { getThemeColors } = require("../../themes/resolver");
const { KENO_MAX_SPOTS, quickPick, drawNumbers, resolveKeno } = require("../../utils/keno");

const themeArgIdx = process.argv.indexOf("--theme");
const THEME_ID = themeArgIdx !== -1 && process.argv[themeArgIdx + 1]
  ? process.argv[themeArgIdx + 1]
  : "classic";

const COLORS = getThemeColors(THEME_ID, "keno");

function seededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe("kenoCanvas smoke", () => {
  test.each(Array.from({ length: KENO_MAX_SPOTS }, (_, i) => i + 1))(
    "renders a %i-spot result without throwing",
    async (spotCount) => {
      const spots = quickPick(spotCount, seededRng(spotCount * 13));
      const result = resolveKeno({ spots, bet: 1000, rng: seededRng(spotCount * 29) });

      const attachment = await drawKenoResult({
        spots,
        drawn: result.drawn,
        matched: result.matched,
        matches: result.matches,
        bet: 1000,
        multiplier: result.multiplier,
        payout: result.payout,
        net: result.net,
        balance: 50000,
        currencyName: "koku",
      }, COLORS);

      expect(attachment).toBeDefined();
      expect(attachment.attachment).toBeDefined();
      expect(attachment.attachment.length).toBeGreaterThan(0);
    },
  );

  test("renders a zero-match result without throwing", async () => {
    const drawn = drawNumbers(seededRng(5));
    const drawnSet = new Set(drawn);
    const spots = [];
    for (let n = 1; n <= 80 && spots.length < 6; n++) {
      if (!drawnSet.has(n)) spots.push(n);
    }

    const attachment = await drawKenoResult({
      spots,
      drawn,
      matched: [],
      matches: 0,
      bet: 250,
      multiplier: 0,
      payout: 0,
      net: -250,
      balance: 0,
      currencyName: "koku",
    }, COLORS);

    expect(attachment.attachment.length).toBeGreaterThan(0);
  });

  test("renders a full-hit result without throwing", async () => {
    const drawn = drawNumbers(seededRng(77));
    const spots = drawn.slice(0, 10);

    const attachment = await drawKenoResult({
      spots,
      drawn,
      matched: spots,
      matches: 10,
      bet: 100,
      multiplier: 10000,
      payout: 1000000,
      net: 999900,
      balance: 1000000,
      currencyName: "koku",
    }, COLORS);

    expect(attachment.attachment.length).toBeGreaterThan(0);
  });
});

describe("kenoCanvas paytable smoke", () => {
  test("renders the overview table without throwing", async () => {
    const attachment = await drawPaytable(COLORS);
    expect(attachment.attachment.length).toBeGreaterThan(0);
  });

  test.each(Array.from({ length: KENO_MAX_SPOTS }, (_, i) => i + 1))(
    "renders the %i-spot paytable without throwing",
    async (spots) => {
      const attachment = await drawPaytable(COLORS, { spots });
      expect(attachment.attachment.length).toBeGreaterThan(0);
    },
  );
});
