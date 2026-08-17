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

const { getTheme } = require("./configs");

// Resolve the full color set for a given theme + game combination.
function getThemeColors(themeId, gameId) {
  const classic = getTheme("classic");
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
  const classic = getTheme("classic");

  const symbols = theme.overrides?.slots?.symbols;
  if (symbols && symbols.length > 0) return symbols;
  return classic.overrides.slots.symbols;
}

// Get card spritesheet config for a theme, falling back to classic.
function getCardSheet(themeId) {
  const classic = getTheme("classic");
  const theme   = getTheme(themeId);
  return {
    ...(classic.overrides?.cards ?? {}),
    ...(theme.overrides?.cards   ?? {}),
  };
}

// Resolve blackjack colors, falling back to poker overrides when blackjack
// overrides are not defined. This keeps blackjack and poker visually aligned
// by default while allowing themes to style them independently.
function getBlackjackColors(themeId) {
  const classic = getTheme("classic");
  const theme   = getTheme(themeId);
  const gameId  = "blackjack";
  const fallback = "poker";
  return {
    ...classic.colors,
    ...(classic.overrides?.[gameId] ?? classic.overrides?.[fallback] ?? {}),
    ...theme.colors,
    ...(theme.overrides?.[gameId] ?? theme.overrides?.[fallback] ?? {}),
  };
}

function getDuelColors(themeId) {
  return getThemeColors(themeId, "duel");
}

// Palette values are "#rrggbb" strings but EmbedBuilder wants an integer.
function toEmbedColor(value, fallback = 0x0f4c25) {
  if (typeof value === "number") return value;
  if (!value) return fallback;
  const parsed = parseInt(String(value).replace(/^#/, ""), 16);
  return Number.isNaN(parsed) ? fallback : parsed;
}

module.exports = { getThemeColors, getThemeSymbols, getCardSheet, getBlackjackColors, getDuelColors, toEmbedColor };
