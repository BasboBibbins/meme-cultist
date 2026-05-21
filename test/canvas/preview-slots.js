/**
 * Renders the slot machine for each theme:
 *   slots-<themeId>.gif  — animated spin (via slotsPreview)
 *   slots-<themeId>-result.png — static result with win highlights
 * Usage: node test/canvas/preview-slots.js
 */
const { slotsPreview, drawSlotMachine } = require("../../utils/slotsCanvas");
const { getTheme } = require("../../utils/slotsThemes");
const { THEMES, saveRender } = require("./preview-common");

// A grid with a winning middle row (three 1s) and varied other symbols
const RESULT_GRID = [
  [3, 5, 2],
  [1, 1, 1],
  [4, 2, 6],
];

// Middle-row payline win (line index 1)
const WIN_RESULTS = [
  { line: 1, count: 3, symbol: 1, payout: 50 },
];

(async () => {
  for (const themeId of THEMES) {
    const theme = getTheme(themeId);

    const spin = await slotsPreview(themeId);
    saveRender(spin, `slots-${themeId}.gif`);

    const result = await drawSlotMachine(RESULT_GRID, {
      theme,
      activeLines: 5,
      bet: 1000,
      totalWin: 50000,
      balance: 125000,
      winResults: WIN_RESULTS,
    });
    saveRender(result, `slots-${themeId}-result.png`);
  }
})();
