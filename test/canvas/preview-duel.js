/**
 * Renders a duel result for each theme and saves to tmp/canvas/duel-<themeId>.png.
 * Usage: node test/canvas/preview-duel.js
 */
const { renderDuel } = require("../../utils/duelCanvas");
const { getThemeColors } = require("../../themes/resolver");
const { THEMES, mockUser, saveRender } = require("./preview-common");

(async () => {
  for (const themeId of THEMES) {
    const colors = getThemeColors(themeId, "duel");
    const attachment = await renderDuel({
      challenger:        mockUser("GrandGambler99", 1),
      opponent:          mockUser("RecklessRachel", 7),
      bet:               25000,
      challengerChoice:  "rock",
      opponentChoice:    "scissors",
      result:            "challenger",
      colors,
    });
    saveRender(attachment, `duel-${themeId}.png`);
  }
})();
