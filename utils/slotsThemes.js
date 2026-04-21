/**
 * Slots theme wrapper.
 *
 * Delegates to the global theme system (themes/) while preserving the
 * existing API that slots.js and slotsCanvas.js expect:
 *   getTheme(id) -> { id, name, description, colors, symbols }
 *   getThemeList() -> [{ id, name, description, ... }]
 */

const { getTheme: getThemeConfig, getThemeList: getConfigList } = require('../themes/configs');
const { getThemeColors, getThemeSymbols } = require('../themes/resolver');

/**
 * Get a fully resolved slots theme by ID, falling back to classic.
 *
 * The returned object merges shared + slots-specific colors into a single
 * flat `colors` object, and resolves symbols with classic fallback.
 */
function getTheme(themeId) {
    const config = getThemeConfig(themeId);
    const colors = getThemeColors(config.id, 'slots');

    // For themes without explicit slots frame overrides, inherit from the
    // shared gold keys so colorway palette changes propagate to the frame.
    const slotsOv = config.overrides?.slots;
    if (!slotsOv?.frameColor)    colors.frameColor    = colors.gold;
    if (!slotsOv?.frameDarkColor) colors.frameDarkColor = colors.goldDark;
    if (!slotsOv?.frameBronze)   colors.frameBronze   = colors.goldBronze;
    if (!slotsOv?.dividerColor)  colors.dividerColor  = colors.tableGreen;

    return {
        id:          config.id,
        name:        config.name,
        description: config.description,
        colors,
        symbols:     getThemeSymbols(config.id),
    };
}

/**
 * Get list of all available themes for autocomplete/display.
 */
function getThemeList() {
    return getConfigList();
}

module.exports = { getTheme, getThemeList };
