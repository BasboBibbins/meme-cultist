/**
 * Smoke tests: verify canvas renderers complete without throwing and return
 * something with a buffer attached.  Defaults to "classic"; pass
 * `--theme <id>` after a `--` separator to test a specific theme:
 *
 *   npm run test:canvas -- --theme neon
 */

const path = require("path");
const { getThemeColors, getBlackjackColors } = require("../../themes/resolver");
const { getTheme } = require("../../utils/slotsThemes");
const AVATAR_DIR = path.join(__dirname, "avatars");

function avatarPath(n) {
  return path.join(AVATAR_DIR, `${n}.jpg`);
}

function mockUser(name, n = 1) {
  return { displayName: name, displayAvatarURL: () => avatarPath(n) };
}

const themeArgIdx = process.argv.indexOf("--theme");
const THEME_ID = themeArgIdx !== -1 && process.argv[themeArgIdx + 1]
  ? process.argv[themeArgIdx + 1]
  : "classic";

if (THEME_ID !== "classic") {
  console.log(`[canvas smoke] using theme: ${THEME_ID}`);
}

const CLASSIC = THEME_ID;

describe("blackjackCanvas smoke", () => {
  test("renders a resolved hand without throwing", async () => {
    const { canvasBlackjack } = require("../../utils/blackjackCanvas");
    const colors = getBlackjackColors(CLASSIC);

    const dealerCards = [{ code: "AS" }, { code: "KH" }];
    const playerHands = [{
      cards: [{ code: "0D" }, { code: "8C" }],
      value: 18,
      bust: false,
      isBlackjack: false,
    }];
    const opts = {
      user:          mockUser("Player", 1),
      dealerUser:    mockUser("Dealer", 2),
      outcomes:      ["win"],
      dealerOutcome: "loss",
      playerOutcome: "win",
    };

    const result = await canvasBlackjack(dealerCards, playerHands, colors, CLASSIC, true, 0, opts);
    expect(result).toBeDefined();
    expect(result.attachment).toBeDefined();
  });
});

describe("crapsCanvas smoke", () => {
  test("renders the craps table without throwing", async () => {
    const { drawCrapsTable } = require("../../utils/crapsCanvas");
    const colors = getThemeColors(CLASSIC, "craps");

    const state = {
      phase: "comeout",
      point: null,
      shooterId: "u1",
      shooterUsername: "TestShooter",
      shooterStreak: 1,
      shooterOrder: ["u1"],
      userAvatars: { u1: avatarPath(1) },
      userColors: { u1: "#ffd700" },
      userNames: { u1: "TestShooter" },
      totals: { u1: { wagered: 1000, won: 0, username: "TestShooter" } },
      bets: [{ userId: "u1", betKey: "pass", amount: 100 }],
      lastRoll: null,
      rollHistory: [],
    };

    const result = await drawCrapsTable(state, colors);
    expect(result).toBeDefined();
    expect(result.attachment).toBeDefined();
  });
});

describe("slotsCanvas smoke", () => {
  test("renders a slot machine result without throwing", async () => {
    const { drawSlotMachine } = require("../../utils/slotsCanvas");
    const theme = getTheme(CLASSIC);

    const grid = [
      [1, 1, 1],
      [2, 3, 4],
      [5, 6, 0],
    ];

    const result = await drawSlotMachine(grid, {
      theme,
      activeLines: 1,
      bet: 100,
      totalWin: 300,
      balance: 900,
      winResults: [{ line: 0, count: 3, symbol: 1, payout: 3 }],
    });
    expect(result).toBeDefined();
    expect(result.attachment).toBeDefined();
  });
});

describe("duelCanvas smoke", () => {
  test("renders a duel result without throwing", async () => {
    const { renderDuel } = require("../../utils/duelCanvas");
    const colors = getThemeColors(CLASSIC, "duel");

    const result = await renderDuel({
      challenger:       mockUser("Challenger", 1),
      opponent:         mockUser("Defender",   2),
      bet:              1000,
      challengerChoice: "rock",
      opponentChoice:   "scissors",
      result:           "challenger",
      colors,
    });
    expect(result).toBeDefined();
    expect(result.attachment).toBeDefined();
  });
});
