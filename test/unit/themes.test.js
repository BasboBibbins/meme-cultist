const { getThemeColors, getThemeSymbols, getCardSheet, getBlackjackColors } = require("../../themes/resolver");
const { getTheme, getAllThemes, getThemeList } = require("../../themes/configs/index");

const EXPECTED_BASE_KEYS = [
  "feltColor", "feltDark", "tableGreen",
  "gold", "goldDark", "goldBronze",
  "textWhite", "textWin", "textLoss", "textPrimary",
];

describe("getTheme", () => {
  test("returns classic theme by ID", () => {
    const t = getTheme("classic");
    expect(t.id).toBe("classic");
  });

  test("falls back to classic for unknown theme ID", () => {
    const t = getTheme("nonexistent_theme_xyz");
    expect(t.id).toBe("classic");
  });

  test("returns a named theme by ID", () => {
    const t = getTheme("neon");
    expect(t.id).toBe("neon");
    expect(t.tier).toBe("full");
  });
});

describe("getThemeColors", () => {
  test("returns an object with base color keys for classic", () => {
    const colors = getThemeColors("classic", "slots");
    for (const key of EXPECTED_BASE_KEYS) {
      expect(colors).toHaveProperty(key);
    }
  });

  test("returns an object with base color keys for a full theme", () => {
    const colors = getThemeColors("neon", "slots");
    for (const key of EXPECTED_BASE_KEYS) {
      expect(colors).toHaveProperty(key);
    }
  });

  test("theme overrides take priority over classic colors", () => {
    // neon feltColor is different from classic
    const neonColors  = getThemeColors("neon", "slots");
    const classicColors = getThemeColors("classic", "slots");
    expect(neonColors.feltColor).not.toBe(classicColors.feltColor);
  });

  test("minimal theme (only defines feltColor) still has all base keys via fallback", () => {
    const colors = getThemeColors("minimal", "slots");
    expect(colors.feltColor).toBe("#ff00ff");
    for (const key of EXPECTED_BASE_KEYS) {
      expect(colors).toHaveProperty(key);
    }
  });

  test("game-specific overrides are merged in", () => {
    const neonSlotsColors = getThemeColors("neon", "slots");
    // neon has a slots override with reelBackground
    expect(neonSlotsColors).toHaveProperty("reelBackground");
  });

  test("unknown theme ID falls back to classic", () => {
    const colors = getThemeColors("nonexistent_theme_xyz", "slots");
    const classicColors = getThemeColors("classic", "slots");
    expect(colors.feltColor).toBe(classicColors.feltColor);
  });
});

describe("getThemeSymbols", () => {
  test("returns an array", () => {
    expect(Array.isArray(getThemeSymbols("classic"))).toBe(true);
  });

  test("classic returns symbols", () => {
    const symbols = getThemeSymbols("classic");
    expect(symbols.length).toBeGreaterThan(0);
  });

  test("theme without custom symbols falls back to classic symbols", () => {
    const classicSymbols = getThemeSymbols("classic");
    const minimalSymbols = getThemeSymbols("minimal");
    expect(minimalSymbols).toEqual(classicSymbols);
  });

  test("full theme with custom symbols returns its own symbols", () => {
    const neonSymbols = getThemeSymbols("neon");
    const classicSymbols = getThemeSymbols("classic");
    expect(neonSymbols).not.toEqual(classicSymbols);
  });
});

describe("getBlackjackColors", () => {
  test("returns an object with base color keys", () => {
    const colors = getBlackjackColors("classic");
    for (const key of EXPECTED_BASE_KEYS) {
      expect(colors).toHaveProperty(key);
    }
  });

  test("falls back to poker overrides when no blackjack overrides defined", () => {
    // Most full themes define poker but not blackjack separately
    const colors = getBlackjackColors("neon");
    expect(colors).toBeDefined();
    expect(colors).toHaveProperty("feltColor");
  });
});

describe("getThemeList", () => {
  test("returns an array of theme summaries", () => {
    const list = getThemeList();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
  });

  test("each entry has expected fields", () => {
    const list = getThemeList();
    for (const entry of list) {
      expect(entry).toHaveProperty("id");
      expect(entry).toHaveProperty("name");
      expect(entry).toHaveProperty("tier");
    }
  });

  test("excludes the minimal test theme", () => {
    const list = getThemeList();
    expect(list.find(t => t.id === "minimal")).toBeUndefined();
  });
});

describe("getAllThemes", () => {
  test("returns all themes including minimal", () => {
    const all = getAllThemes();
    expect(all.find(t => t.id === "minimal")).toBeDefined();
  });
});
