/**
 * Renders the slot machine for each theme and saves to tmp/canvas/slots-<themeId>.png.
 * Usage: node test/canvas/preview-slots.js
 */
const { slotsPreview } = require("../../utils/slotsCanvas");
const { THEMES, saveRender } = require("./preview-common");

(async () => {
    for (const themeId of THEMES) {
        const attachment = await slotsPreview(themeId);
        saveRender(attachment, `slots-${themeId}.png`);
    }
})();
