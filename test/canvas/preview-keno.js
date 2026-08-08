/**
 * Renders a keno result and both paytable layouts for each theme.
 * Usage: node test/canvas/preview-keno.js
 */
const { kenoPreview, drawPaytable } = require("../../utils/kenoCanvas");
const { getThemeColors } = require("../../themes/resolver");
const { THEMES, saveRender } = require("./preview-common");

(async () => {
  for (const themeId of THEMES) {
    const colors = getThemeColors(themeId, "keno");
    saveRender(await kenoPreview(themeId), `keno-${themeId}.png`);
    saveRender(await drawPaytable(colors), `keno-paytable-${themeId}.png`);
    saveRender(await drawPaytable(colors, { spots: 10 }), `keno-paytable-10spot-${themeId}.png`);
  }
})();
