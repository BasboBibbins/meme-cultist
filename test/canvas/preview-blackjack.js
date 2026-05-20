/**
 * Renders a blackjack hand (resolved state) for each theme and saves to tmp/canvas/blackjack-<themeId>.png.
 * Usage: node test/canvas/preview-blackjack.js
 */
const { canvasBlackjack } = require("../../utils/blackjackCanvas");
const { getThemeColors } = require("../../themes/resolver");
const { THEMES, avatarPath, saveRender } = require("./preview-common");

const dealerCards = [
    { code: "AS" },
    { code: "KH" },
];

const playerHands = [
    {
        cards: [
            { code: "0D" },
            { code: "8C" },
        ],
        value: 18,
        bust: false,
        isBlackjack: false,
    },
];

const opts = {
    user:          { displayName: "GrandGambler99",   displayAvatarURL: () => avatarPath(1) },
    dealerUser:    { displayName: "Dealer",           displayAvatarURL: () => avatarPath(2) },
    outcomes:      ["win"],
    dealerOutcome: "loss",
    playerOutcome: "win",
};

(async () => {
    for (const themeId of THEMES) {
        const colors = getThemeColors(themeId, "blackjack");
        const attachment = await canvasBlackjack(dealerCards, playerHands, colors, themeId, true, 0, opts);
        saveRender(attachment, `blackjack-${themeId}.png`);
    }
})();
