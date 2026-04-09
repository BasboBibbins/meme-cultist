/**
 * Theme registry.
 *
 * Every theme the bot ships is defined here.  The classic base is imported
 * from base.js; all others only need to declare the keys they override.
 *
 * Theme tiers:
 *   colorway  - palette swap only, no custom art
 *   styled    - custom sprites for ONE game
 *   full      - custom sprites for ALL canvas games
 */

const path = require('path');
const classic = require('./base');

const ASSETS_BASE = path.join(__dirname, '..', '..', 'assets', 'imgs', 'slots');

// ── Helper: build a colorway (palette-only, all games) ──────────────
function colorway(id, name, description, price, colors) {
    return { id, name, description, tier: 'colorway', price, game: null, colors, overrides: {} };
}

// ─────────────────────────────────────────────────────────────────────
const themes = {
    classic,

    // ── Styled themes (one game, custom sprites) ────────────────────

    neon: {
        id: 'neon',
        name: 'Neon Arcade',
        description: 'A vibrant neon theme with glowing symbols.',
        tier: 'styled',
        price: 15000,
        game: 'slots',

        colors: {
            feltColor:   '#1a0a2e',
            feltDark:    '#0f0520',
            tableGreen:  '#2a1a4a',
            gold:        '#c0c0c0',
            goldDark:    '#808080',
            goldBronze:  '#6a6a6a',
            textWhite:   '#e0d8f0',
            textWin:     '#88ffaa',
            textLoss:    '#ff6688',
            textPrimary: '#c0c0c0',
        },

        overrides: {
            slots: {
                reelBackground:      '#120828',
                frameColor:          '#c0c0c0',
                frameDarkColor:      '#808080',
                frameBronze:         '#6a6a6a',
                dividerColor:        '#2a1a4a',
                highlightWin:        'rgba(192, 192, 192, 0.5)',
                bannerBackground:    '#1a0030',
                bannerBackgroundEnd: '#0f001a',
                motionBlurOverlay:   'rgba(15, 5, 32, 0.5)',
                paylineColors:       ['#ff5577', '#55ff99', '#5588ff', '#ffaa44', '#cc55ff'],

                symbols: [
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'neon.png'), index: 0, label: 'Cherry' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'neon.png'), index: 1, label: 'Bell' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'neon.png'), index: 2, label: 'Lemon' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'neon.png'), index: 3, label: 'Grapes' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'neon.png'), index: 4, label: 'Orange' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'neon.png'), index: 5, label: 'Apple' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'neon.png'), index: 6, label: 'BAR' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'neon.png'), index: 7, label: 'Seven' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'neon.png'), index: 8, label: 'Wild' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'neon.png'), index: 9, label: 'Bonus' },
                ],
            },
            roulette: {
                woodInner: '#2e1a4a',
                woodMid: '#1a0a2e',
                woodOuter: '#0f0520',
                goldRim: '#c0c0c0',
                pocketRed: '#ff0055',
                pocketBlack: '#1a0a2e',
                pocketGreen: '#00ffcc',
                winnerHighlight: '#ffffff',
                textBlack: '#1a0a2e',
                textWhite: '#e0d8f0',
                feltInner: '#1a0a2e',
                feltMid: '#2a1a4a',
                feltOuter: '#1a0a2e',
                spokeColor: '#c0c0c0',
                hubLight: '#e0d8f0',
                hubMid: '#c0c0c0',
                hubDark: '#808080',
                hubStroke: '#ffffff',
                tableGreen: '#2a1a4a',
                zeroGreen: '#00ffcc',
                numberRed: '#ff0055',
                numberBlack: '#1a0a2e',
                betArea: '#3a2a5a',
                betBorder: '#c0c0c0',
                resultOverlay: 'rgba(26, 10, 46, 0.85)',
                resultBorder: '#00ffcc',
            },
            poker: {
                feltColor: '#1a0a2e',
                tableGreen: '#2a1a4a',
                gold: '#c0c0c0',
                goldDark: '#808080',
            },
        },
    },

    feudalJapan: {
        id: 'feudalJapan',
        name: 'Feudal Japan',
        description: 'Traditional Japanese theme with feudal symbols.',
        tier: 'styled',
        price: 15000,
        game: 'slots',

        colors: {
            feltColor:   '#4a0000',
            feltDark:    '#2a0000',
            tableGreen:  '#3a0000',
            gold:        '#ffd700',
            goldDark:    '#c8a830',
            goldBronze:  '#8b6914',
            textWhite:   '#ffffff',
            textWin:     '#44ff44',
            textLoss:    '#ff4444',
            textPrimary: '#ffd700',
        },

        overrides: {
            slots: {
                reelBackground:      '#1a0000',
                frameColor:          '#ffd700',
                frameDarkColor:      '#c8a830',
                frameBronze:         '#8b6914',
                dividerColor:        '#3a0000',
                highlightWin:        'rgba(255, 215, 0, 0.6)',
                bannerBackground:    '#000000',
                bannerBackgroundEnd: '#1a0000',
                motionBlurOverlay:   'rgba(26, 0, 0, 0.5)',
                paylineColors:       ['#ff0000', '#ffd700', '#ffffff', '#ffaa00', '#aa0000'],

                symbols: [
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'feudalJapan.png'), index: 0, label: 'Bamboo' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'feudalJapan.png'), index: 1, label: 'Torii Gate' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'feudalJapan.png'), index: 2, label: 'Hanafuda' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'feudalJapan.png'), index: 3, label: 'Castle' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'feudalJapan.png'), index: 4, label: 'Blossom' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'feudalJapan.png'), index: 5, label: 'Dolls' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'feudalJapan.png'), index: 6, label: 'Katana' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'feudalJapan.png'), index: 7, label: 'Dragon' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'feudalJapan.png'), index: 8, label: 'Fan' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'feudalJapan.png'), index: 9, label: 'Lantern' },
                ],
            },
            roulette: {
                woodInner: '#5d2906',
                woodMid: '#3d1b04',
                woodOuter: '#2d1503',
                goldRim: '#ffd700',
                pocketRed: '#cc0000',
                pocketBlack: '#1a1a1a',
                pocketGreen: '#006400',
                winnerHighlight: '#ffd700',
                textBlack: '#2d1503',
                textWhite: '#ffffff',
                feltInner: '#4a0000',
                feltMid: '#6a0000',
                feltOuter: '#3a0000',
                spokeColor: '#ffd700',
                hubLight: '#ffd700',
                hubMid: '#c8a830',
                hubDark: '#8b6914',
                hubStroke: '#ffffff',
                tableGreen: '#3a0000',
                zeroGreen: '#006400',
                numberRed: '#cc0000',
                numberBlack: '#1a1a1a',
                betArea: '#5a0000',
                betBorder: '#ffd700',
                resultOverlay: 'rgba(74, 0, 0, 0.85)',
                resultBorder: '#ffd700',
            },
            poker: {
                feltColor: '#4a0000',
                tableGreen: '#3a0000',
                gold: '#ffd700',
                goldDark: '#c8a830',
            },
        },
    },

    // ── Colorway themes (palette only, all games) ───────────────────

    midnight: colorway('midnight', 'Midnight',
        'Deep navy and silver. A sleek, cooler-toned alternative to classic.',
        2000,
        {
            feltColor:   '#000033',
            feltDark:    '#00001a',
            tableGreen:  '#000044',
            gold:        '#c0c0c0',
            goldDark:    '#808080',
            goldBronze:  '#a0a0a0',
            textWhite:   '#ffffff',
            textWin:     '#44ff44',
            textLoss:    '#ff4444',
            textPrimary: '#c0c0c0',
            embedColor:  0x000033,
        },
    ),

    cherryPop: colorway('cherryPop', 'Cherry Pop',
        'Hot pink and white felt with red accents. Fun and arcade-y.',
        2000,
        {
            feltColor:   '#ff69b4',
            feltDark:    '#c71585',
            tableGreen:  '#ff1493',
            gold:        '#ffffff',
            goldDark:    '#ff0000',
            goldBronze:  '#ffc0cb',
            textWhite:   '#ffffff',
            textWin:     '#00ff00',
            textLoss:    '#8b0000',
            textPrimary: '#ffffff',
            embedColor:  0xff69b4,
        },
    ),

    emerald: colorway('emerald', 'Emerald',
        'Richer, deeper greens than Classic. A premium classic tier.',
        2000,
        {
            feltColor:   '#004d00',
            feltDark:    '#003300',
            tableGreen:  '#006600',
            gold:        '#ffd700',
            goldDark:    '#c8a830',
            goldBronze:  '#8b6914',
            textWhite:   '#ffffff',
            textWin:     '#44ff44',
            textLoss:    '#ff4444',
            textPrimary: '#ffd700',
            embedColor:  0x004d00,
        },
    ),

    ocean: colorway('ocean', 'Ocean',
        'Teal and deep blue felt with seafoam highlights.',
        2000,
        {
            feltColor:   '#008080',
            feltDark:    '#004d4d',
            tableGreen:  '#00cccc',
            gold:        '#ff7f50',
            goldDark:    '#cd853f',
            goldBronze:  '#f4a460',
            textWhite:   '#ffffff',
            textWin:     '#44ff44',
            textLoss:    '#ff4444',
            textPrimary: '#e0ffff',
            embedColor:  0x008080,
        },
    ),

    ember: colorway('ember', 'Ember',
        'Deep charcoal felt with orange and amber frame colors.',
        2000,
        {
            feltColor:   '#333333',
            feltDark:    '#1a1a1a',
            tableGreen:  '#444444',
            gold:        '#ff8c00',
            goldDark:    '#cc7a00',
            goldBronze:  '#8b4513',
            textWhite:   '#ffffff',
            textWin:     '#44ff44',
            textLoss:    '#ff4444',
            textPrimary: '#ffae42',
            embedColor:  0x333333,
        },
    ),

    frost: colorway('frost', 'Frost',
        'Icy pale blue and white with silver frames.',
        2000,
        {
            feltColor:   '#afeaea',
            feltDark:    '#b0e0e6',
            tableGreen:  '#add8e6',
            gold:        '#c0c0c0',
            goldDark:    '#808080',
            goldBronze:  '#a9a9a9',
            textWhite:   '#ffffff',
            textWin:     '#44ff44',
            textLoss:    '#ff4444',
            textPrimary: '#4682b4',
            embedColor:  0xafeaea,
        },
    ),

    royalPurple: colorway('royalPurple', 'Royal Purple',
        'Deep purple felt with gold frames. A premium combination.',
        2000,
        {
            feltColor:   '#4b0082',
            feltDark:    '#2e0054',
            tableGreen:  '#6a0dad',
            gold:        '#ffd700',
            goldDark:    '#c8a830',
            goldBronze:  '#8b6914',
            textWhite:   '#ffffff',
            textWin:     '#44ff44',
            textLoss:    '#ff4444',
            textPrimary: '#ffd700',
            embedColor:  0x4b0082,
        },
    ),

    // ── Test theme ──────────────────────────────────────────────────

    minimal: {
        id: 'minimal',
        name: 'Minimal Test',
        description: 'A theme that tests fallbacks by only defining one color.',
        tier: 'colorway',
        price: 0,
        game: null,
        colors: {
            feltColor: '#ff00ff',
        },
        overrides: {},
    },
};

// ─────────────────────────────────────────────────────────────────────

/**
 * Get a theme definition by ID. Returns classic if not found.
 */
function getTheme(themeId) {
    return themes[themeId] || themes.classic;
}

/**
 * Get all theme definitions as an array.
 */
function getAllThemes() {
    return Object.values(themes);
}

/**
 * Get a summary list suitable for autocomplete / display.
 */
function getThemeList() {
    return Object.values(themes)
        .filter(t => t.id !== 'minimal')
        .map(t => ({
            id:          t.id,
            name:        t.name,
            description: t.description,
            tier:        t.tier,
            price:       t.price,
        }));
}

module.exports = { themes, getTheme, getAllThemes, getThemeList };
