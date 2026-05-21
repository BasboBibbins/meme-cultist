/**
 * Renders a busy craps table for each of the five preview themes and saves
 * each image to tmp/canvas/craps-<themeId>.png.
 * Usage: node test/canvas/preview-craps.js
 */
const { drawCrapsTable } = require("../../utils/crapsCanvas");
const { getThemeColors } = require("../../themes/resolver");
const { THEMES, OUT_DIR, PLAYERS, avatarPath, saveRender } = require("./preview-common");

const state = {
  phase: "point",
  point: 8,
  shooterId: "u1",
  shooterUsername: "GrandGambler99",
  shooterStreak: 3,
  shooterOrder: PLAYERS.map((p) => p.id),
  userAvatars: Object.fromEntries(PLAYERS.map((p) => [p.id, avatarPath(p.avatar)])),
  userColors: Object.fromEntries(PLAYERS.map((p) => [p.id, p.color])),
  userNames: Object.fromEntries(PLAYERS.map((p) => [p.id, p.name])),
  totals: {
    u1: { wagered: 45000,  won: 12500,  username: "GrandGambler99"   },
    u2: { wagered: 32000,  won: -8200,  username: "HotHandHannah"   },
    u3: { wagered: 120000, won: 55000,  username: "BigBettorBruno"  },
    u4: { wagered: 7800,   won: 1200,   username: "LuckyLarryLong"  },
    u5: { wagered: 19500,  won: -4400,  username: "NightOwlNorbert" },
    u6: { wagered: 5000,   won: 0,      username: "SteadyEddie"     },
    u7: { wagered: 88000,  won: -22000, username: "RecklessRachel"  },
  },
  bets: [
    // Pass line — five players
    { userId: "u1", betKey: "pass",     amount: 10000 },
    { userId: "u2", betKey: "pass",     amount: 5000  },
    { userId: "u3", betKey: "pass",     amount: 25000 },
    { userId: "u5", betKey: "pass",     amount: 8000  },
    { userId: "u6", betKey: "pass",     amount: 1000  },
    // Don't pass — two players
    { userId: "u4", betKey: "dontPass", amount: 3500  },
    { userId: "u7", betKey: "dontPass", amount: 40000 },
    // Field — four players
    { userId: "u1", betKey: "field",    amount: 2500  },
    { userId: "u3", betKey: "field",    amount: 15000 },
    { userId: "u4", betKey: "field",    amount: 500   },
    { userId: "u7", betKey: "field",    amount: 10000 },
    // Any 7 — three players
    { userId: "u2", betKey: "any7",     amount: 1000  },
    { userId: "u5", betKey: "any7",     amount: 2000  },
    { userId: "u7", betKey: "any7",     amount: 5000  },
    // Any craps — two players
    { userId: "u1", betKey: "anyCraps", amount: 500   },
    { userId: "u6", betKey: "anyCraps", amount: 750   },
  ],
  lastRoll: { d1: 5, d2: 3, total: 8 },
  rollHistory: [
    { d1: 3, d2: 4, total: 7,  kind: "natural"              },
    { d1: 1, d2: 2, total: 3,  kind: "crap"                 },
    { d1: 4, d2: 4, total: 8,  kind: "pointSet", point: 8   },
    { d1: 2, d2: 6, total: 8,  kind: "pointHit"             },
    { d1: 6, d2: 1, total: 7,  kind: "sevenOut"             },
    { d1: 5, d2: 6, total: 11, kind: "natural"              },
    { d1: 3, d2: 5, total: 8,  kind: "pointSet", point: 8   },
    { d1: 2, d2: 3, total: 5,  kind: "neutral"              },
    { d1: 4, d2: 1, total: 5,  kind: "neutral"              },
    { d1: 5, d2: 3, total: 8,  kind: "pointHit"             },
  ],
};

(async () => {
  for (const themeId of THEMES) {
    const colors = getThemeColors(themeId, "craps");
    const attachment = await drawCrapsTable(state, colors);
    saveRender(attachment, `craps-${themeId}.png`);
  }
})();
