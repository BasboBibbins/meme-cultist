/**
 * Renders a blackjack hand (resolved state) for each theme and saves to tmp/canvas/blackjack-<themeId>.png.
 * Usage: node test/canvas/preview-blackjack.js
 */
const { canvasBlackjack } = require("../../utils/blackjackCanvas");
const { getThemeColors } = require("../../themes/resolver");
const { THEMES, avatarPath, saveRender } = require("./preview-common");

const dealerCards = [
  { code: "AS", suit: "SPADES", value: "ACE", emoji: "♠️", name: "Ace", char: "A", numericValue: 11 },
  { code: "KH", suit: "HEARTS", value: "KING", emoji: "♥️", name: "King", char: "K", numericValue: 10 },
];

const playerHands = [
  {
    cards: [
      { code: "0D", suit: "DIAMONDS", value: "10", emoji: "♦️", name: "Ten", char: "10", numericValue: 10 },
      { code: "8C", suit: "CLUBS", value: "8", emoji: "♣️", name: "Eight", char: "8", numericValue: 8 },
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
