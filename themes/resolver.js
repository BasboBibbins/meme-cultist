/**
 * Theme resolver -- four-layer color merge.
 *
 * Merge order:
 *   1. classic.colors           (shared fallback)
 *   2. classic.overrides[game]  (game-specific fallback)
 *   3. theme.colors             (theme shared palette)
 *   4. theme.overrides[game]    (theme game-specific)
 *
 * The result is a flat object.  Each game reads whichever keys it needs.
 */

const { getTheme } = require('./configs');

// Resolve the full color set for a given theme + game combination.
function getThemeColors(themeId, gameId) {
    const classic = getTheme('classic');
    const theme   = getTheme(themeId);

    return {
        ...classic.colors,
        ...(classic.overrides?.[gameId] ?? {}),
        ...theme.colors,
        ...(theme.overrides?.[gameId] ?? {}),
    };
}

// Get slot symbols for a theme, falling back to classic symbols.
function getThemeSymbols(themeId) {
    const theme   = getTheme(themeId);
    const classic = getTheme('classic');

    const symbols = theme.overrides?.slots?.symbols;
    if (symbols && symbols.length > 0) return symbols;
    return classic.overrides.slots.symbols;
}

module.exports = { getThemeColors, getThemeSymbols };
