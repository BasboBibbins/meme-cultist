/**
 * Renders a busy roulette table for each theme and saves to tmp/canvas/roulette-<themeId>.png.
 * Usage: node test/canvas/preview-roulette.js
 */
const { drawRouletteTable } = require("../../utils/roulette");
const { getThemeColors } = require("../../themes/resolver");
const { THEMES, PLAYERS, avatarPath, saveRender } = require("./preview-common");

const bets = [
    { number: 7,  userId: "u1", amount: 10000 },
    { number: 14, userId: "u2", amount: 5000  },
    { number: 0,  userId: "u3", amount: 25000 },
    { number: 22, userId: "u4", amount: 3500  },
    { number: 36, userId: "u5", amount: 8000  },
    { number: 17, userId: "u1", amount: 2500  },
    { number: 3,  userId: "u6", amount: 1000  },
    { number: 29, userId: "u7", amount: 40000 },
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
