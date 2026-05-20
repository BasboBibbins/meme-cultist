/**
 * Renders a busy roulette table for each theme and saves to tmp/canvas/roulette-<themeId>.png.
 * Usage: node test/canvas/preview-roulette.js
 */
const { drawRouletteTable } = require("../../utils/roulette");
const { getThemeColors } = require("../../themes/resolver");
const { THEMES, PLAYERS, avatarPath, saveRender } = require("./preview-common");

const bets = [
    // Straight-up numbers — multiple users on the same spot
    { number: 7,        userId: "u1", amount: 10000 },
    { number: 7,        userId: "u3", amount: 4000  },
    { number: 7,        userId: "u5", amount: 1500  },
    { number: 17,       userId: "u1", amount: 2500  },
    { number: 17,       userId: "u2", amount: 6000  },
    { number: 0,        userId: "u3", amount: 25000 },
    { number: 0,        userId: "u7", amount: 5000  },
    { number: 22,       userId: "u4", amount: 3500  },
    { number: 36,       userId: "u5", amount: 8000  },
    { number: 3,        userId: "u6", amount: 1000  },
    { number: 14,       userId: "u2", amount: 5000  },
    { number: 29,       userId: "u7", amount: 40000 },
    // Even-money outside bets
    { number: "red",    userId: "u1", amount: 20000 },
    { number: "red",    userId: "u4", amount: 8000  },
    { number: "red",    userId: "u2", amount: 15000 },
    { number: "red",    userId: "u3", amount: 12000 },
    { number: "black",  userId: "u5", amount: 9000  },
    { number: "low",    userId: "u6", amount: 7500  },
    { number: "high",   userId: "u7", amount: 11000 },
    { number: "high",   userId: "u1", amount: 3000  },
    // Dozens
    { number: "dozen1", userId: "u2", amount: 5000  },
    { number: "dozen2", userId: "u4", amount: 4500  },
    { number: "dozen2", userId: "u6", amount: 2000  },
    { number: "dozen3", userId: "u3", amount: 6000  },
    // Columns
    { number: "column1", userId: "u5", amount: 8000 },
    { number: "column2", userId: "u7", amount: 3500 },
    { number: "column2", userId: "u2", amount: 1500 },
    { number: "column3", userId: "u1", amount: 5000 },
];

const userAvatars = Object.fromEntries(PLAYERS.map((p) => [p.id, avatarPath(p.avatar)]));
const userColors  = Object.fromEntries(PLAYERS.map((p) => [p.id, p.color]));

(async () => {
    for (const themeId of THEMES) {
        const colors = getThemeColors(themeId, "roulette");
        const attachment = await drawRouletteTable(bets, userAvatars, userColors, colors);
        saveRender(attachment, `roulette-${themeId}.png`);
    }
})();
