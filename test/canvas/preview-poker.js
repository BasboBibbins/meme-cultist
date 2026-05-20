/**
 * Renders a Royal Flush poker hand for each theme and saves to tmp/canvas/poker-<themeId>.png.
 * Usage: node test/canvas/preview-poker.js
 */
const { pokerPreview } = require("../../utils/poker");
const { THEMES, saveRender } = require("./preview-common");

(async () => {
    for (const themeId of THEMES) {
        const attachment = await pokerPreview(themeId);
        saveRender(attachment, `poker-${themeId}.png`);
    }
})();
