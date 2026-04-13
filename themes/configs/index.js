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
const BACKGROUND_BASE = path.join(__dirname, '..', '..', 'assets', 'imgs', 'themes');

// ── Helper: build a colorway (palette-only, all games) ──────────────
function colorway(id, name, description, price, weight, emoji, colors) {
    return { id, name, description, tier: 'colorway', price, weight, emoji, game: null, colors, overrides: {} };
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
        price: 150000,
        weight: 20,
        emoji: '🪩',
        game: 'slots',

        colors: {
            background:  path.join(BACKGROUND_BASE, 'neon.png'),
            feltColor:   'rgba(26, 10, 46, 0.8)',
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
                reelBackground:      'rgba(18, 8, 40, 0.75)',
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
                feltColor: 'rgba(26, 10, 46, 0.8)',
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
        price: 250000,
        weight: 20,
        emoji: '🎋',
        game: 'slots',

        colors: {
            background:  path.join(BACKGROUND_BASE, 'feudalJapan.png'),
            feltColor:   'rgba(74, 0, 0, 0.8)',
            feltDark:    'rgba(42, 0, 0, 0.8)',
            tableGreen:  'rgba(58, 0, 0, 0.5)',
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
                reelBackground:      'rgba(26, 0, 0, 0.75)',
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
                feltInner: 'rgba(74, 0, 0, 0.8)',
                feltMid: 'rgba(106, 0, 0, 0.8)',
                feltOuter: 'rgba(58, 0, 0, 0.8)',
                spokeColor: '#ffd700',
                hubLight: '#ffd700',
                hubMid: '#c8a830',
                hubDark: '#8b6914',
                hubStroke: '#ffffff',
                tableGreen: 'rgba(58, 0, 0, 0.5)',
                zeroGreen: '#006400',
                numberRed: '#cc0000',
                numberBlack: '#1a1a1a',
                betArea: '#5a0000',
                betBorder: '#ffd700',
                resultOverlay: 'rgba(74, 0, 0, 0.85)',
                resultBorder: '#ffd700',
            },
            poker: {
                feltColor: 'rgba(74, 0, 0, 0.8)',
                tableGreen: 'rgba(58, 0, 0, 0.5)',
                gold: '#ffd700',
                goldDark: '#c8a830',
            },
        },
    },

    cosmic: {
        id: 'cosmic',
        name: 'Cosmic',
        description: 'A extraterrestrial theme with cosmic symbols and a starry background.',
        tier: 'full',
        price: 500000,
        weight: 5,
        emoji: '🌌',
        game: null,

        colors: {
            background:  path.join(BACKGROUND_BASE, 'cosmic.png'),
            feltColor:   'rgba(10, 14, 26, 0.8)',
            feltDark:    '#060a14',
            tableGreen:  '#121830',
            gold:        '#b8c0d0',
            goldDark:    '#7a8090',
            goldBronze:  '#5a6478',
            textWhite:   '#e0e8ff',
            textBlack:   '#050810',
            textWin:     '#88ff44',
            textLoss:    '#ff3388',
            textPrimary: '#00ccff',
            embedColor:  0x0a0e1a,
        },

        overrides: {
            slots: {
                reelBackground:      'rgba(8, 12, 24, 0.75)',
                frameColor:          '#b8c0d0',
                frameDarkColor:      '#7a8090',
                frameBronze:         '#5a6478',
                dividerColor:        '#1a2040',
                highlightWin:        'rgba(0, 204, 255, 0.5)',
                bannerBackground:    '#0a0020',
                bannerBackgroundEnd: '#050010',
                motionBlurOverlay:   'rgba(10, 14, 26, 0.5)',
                paylineColors:       ['#00ccff', '#ff3388', '#88ff44', '#ff8800', '#aa44ff'],

                symbols: [
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'cosmic.png'), index: 0, label: 'Planet' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'cosmic.png'), index: 1, label: 'Rocket' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'cosmic.png'), index: 2, label: 'Asteroid' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'cosmic.png'), index: 3, label: 'Alien' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'cosmic.png'), index: 4, label: 'Sattelite' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'cosmic.png'), index: 5, label: 'Star' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'cosmic.png'), index: 6, label: 'Nebula' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'cosmic.png'), index: 7, label: 'Comet' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'cosmic.png'), index: 8, label: 'Galaxy' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'cosmic.png'), index: 9, label: 'Bonus' },
                ],
            },
            roulette: {
                woodInner:       '#2a3050',
                woodMid:         '#1a2040',
                woodOuter:       '#0e1428',
                goldRim:         '#b8c0d0',
                pocketRed:       '#ff3388',
                pocketBlack:     '#0a0e1a',
                pocketGreen:     '#88ff44',
                winnerHighlight: '#00ccff',
                textBlack:       '#0a0e1a',
                textWhite:       '#e0e8ff',
                feltInner:       '#121830',
                feltMid:         '#1a2040',
                feltOuter:       '#0e1428',
                spokeColor:      '#b8c0d0',
                hubLight:        '#e0e8ff',
                hubMid:          '#b8c0d0',
                hubDark:         '#7a8090',
                hubStroke:       '#00ccff',
                tableGreen:      '#121830',
                zeroGreen:       '#88ff44',
                numberRed:       '#ff3388',
                numberBlack:     '#0a0e1a',
                betArea:         '#1a2248',
                betBorder:       '#b8c0d0',
                resultOverlay:   'rgba(10, 14, 26, 0.85)',
                resultBorder:    '#00ccff',
            },
            poker: {
                feltColor:  'rgba(10, 14, 26, 0.8)',
                tableGreen: '#121830',
                gold:       '#b8c0d0',
                goldDark:   '#7a8090',
            },
        },
    },

    dessert: {
        id: 'dessert',
        name: 'Sweet Tooth',
        description: 'A candy land of chocolate, bubblegum, and sweets.',
        tier: 'full',
        price: 500000,
        weight: 5,
        emoji: '🍰',
        game: null,

        colors: {
            background:  path.join(BACKGROUND_BASE, 'dessert.png'),
            feltColor:   'rgba(59, 26, 10, 0.8)',
            feltDark:    '#2a1008',
            tableGreen:  '#4e2212',
            gold:        '#f5e0c0',
            goldDark:    '#c8a87a',
            goldBronze:  '#8b6540',
            textWhite:   '#fff5f0',
            textBlack:   '#1a0a04',
            textWin:     '#ff88cc',
            textLoss:    '#cc4444',
            textPrimary: '#f7c8d8',
            embedColor:  0x3b1a0a,
        },

        overrides: {
            slots: {
                reelBackground:      'rgba(42, 16, 8, 0.75)',
                frameColor:          '#f5e0c0',
                frameDarkColor:      '#c8a87a',
                frameBronze:         '#8b6540',
                dividerColor:        '#5c3018',
                highlightWin:        'rgba(255, 136, 204, 0.55)',
                bannerBackground:    '#2a0a10',
                bannerBackgroundEnd: '#1a0608',
                motionBlurOverlay:   'rgba(42, 16, 8, 0.5)',
                paylineColors:       ['#ff69b4', '#66d98e', '#f5d742', '#e84040', '#8fd4f5'],

                symbols: [
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'dessert.png'), index: 0, label: 'Lollipop' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'dessert.png'), index: 1, label: 'Cupcake' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'dessert.png'), index: 2, label: 'Candy Cane' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'dessert.png'), index: 3, label: 'Gummy Bear' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'dessert.png'), index: 4, label: 'Chocolate' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'dessert.png'), index: 5, label: 'Candy' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'dessert.png'), index: 6, label: 'BAR' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'dessert.png'), index: 7, label: 'Jawbreaker' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'dessert.png'), index: 8, label: 'Wild' },
                    { type: 'sprite', path: path.join(ASSETS_BASE, 'dessert.png'), index: 9, label: 'Golden Ticket' },
                ],
            },
            roulette: {
                woodInner:       '#5c2e14',
                woodMid:         '#3b1a0a',
                woodOuter:       '#2a1008',
                goldRim:         '#f5e0c0',
                pocketRed:       '#e84040',
                pocketBlack:     '#2a1008',
                pocketGreen:     '#66d98e',
                winnerHighlight: '#ff88cc',
                textBlack:       '#1a0a04',
                textWhite:       '#fff5f0',
                feltInner:       '#4e2212',
                feltMid:         '#5c3018',
                feltOuter:       '#3b1a0a',
                spokeColor:      '#f5e0c0',
                hubLight:        '#fff5f0',
                hubMid:          '#f5e0c0',
                hubDark:         '#c8a87a',
                hubStroke:       '#ff88cc',
                tableGreen:      '#4e2212',
                zeroGreen:       '#66d98e',
                numberRed:       '#e84040',
                numberBlack:     '#2a1008',
                betArea:         '#5c3018',
                betBorder:       '#f5e0c0',
                resultOverlay:   'rgba(42, 16, 8, 0.85)',
                resultBorder:    '#ff88cc',
            },
            poker: {
                feltColor:  'rgba(59, 26, 10, 0.8)',
                tableGreen: '#4e2212',
                gold:       '#f5e0c0',
                goldDark:   '#c8a87a',
            },
        },
    },

    // ── Colorway themes (palette only, all games) ───────────────────

    midnight: colorway('midnight', 'Midnight',
        'Deep navy and silver. A sleek, cooler-toned alternative to classic.',
        10000, 60, '🌙',
        {
            feltColor:   '#000033',
            feltDark:    '#00001a',
            tableGreen:  '#000044',
            gold:        '#c0c0c0',
            goldDark:    '#808080',
            goldBronze:  '#a0a0a0',
            textWhite:   '#ffffff',
            textWin:     '#44ccaa',
            textLoss:    '#ff5566',
            textPrimary: '#c0c0c0',
            embedColor:  0x000033,
        },
    ),

    cherryPop: colorway('cherryPop', 'Cherry Pop',
        'Rich rose and soft pink frames. Fun and retro.',
        10000, 60, '🍒',
        {
            feltColor:   '#8b2252',
            feltDark:    '#6b1a3e',
            tableGreen:  '#a03060',
            gold:        '#f0c8d8',
            goldDark:    '#d4a0b8',
            goldBronze:  '#b07090',
            textWhite:   '#fff0f5',
            textWin:     '#66ffaa',
            textLoss:    '#ff5068',
            textPrimary: '#f0c8d8',
            embedColor:  0x8b2252,
        },
    ),

    emerald: colorway('emerald', 'Emerald',
        'Richer, deeper greens than Classic. A premium classic tier.',
        10000, 60, '💚',
        {
            feltColor:   '#004d00',
            feltDark:    '#003300',
            tableGreen:  '#006600',
            gold:        '#ffd700',
            goldDark:    '#c8a830',
            goldBronze:  '#8b6914',
            textWhite:   '#ffffff',
            textWin:     '#55ee55',
            textLoss:    '#ee5544',
            textPrimary: '#ffd700',
            embedColor:  0x004d00,
        },
    ),

    ocean: colorway('ocean', 'Ocean',
        'Deep teal felt with warm coral accents and seafoam highlights.',
        10000, 60, '🌊',
        {
            feltColor:   '#0a4f5c',
            feltDark:    '#063840',
            tableGreen:  '#1a6878',
            gold:        '#e8a065',
            goldDark:    '#b87840',
            goldBronze:  '#986038',
            textWhite:   '#e0f0f0',
            textWin:     '#55ddaa',
            textLoss:    '#ff6655',
            textPrimary: '#90d8d0',
            embedColor:  0x0a4f5c,
        },
    ),

    ember: colorway('ember', 'Ember',
        'Deep charcoal felt with orange and amber frame colors.',
        10000, 60, '🔥',
        {
            feltColor:   '#333333',
            feltDark:    '#1a1a1a',
            tableGreen:  '#444444',
            gold:        '#ff8c00',
            goldDark:    '#cc7a00',
            goldBronze:  '#8b4513',
            textWhite:   '#ffffff',
            textWin:     '#88cc44',
            textLoss:    '#ff6644',
            textPrimary: '#ffae42',
            embedColor:  0x333333,
        },
    ),

    frost: colorway('frost', 'Frost',
        'Icy steel-blue felt with pale silver frames.',
        10000, 60, '❄️',
        {
            feltColor:   '#3a5a70',
            feltDark:    '#2a4050',
            tableGreen:  '#4a6a80',
            gold:        '#c8d8e8',
            goldDark:    '#98b0c0',
            goldBronze:  '#7898a8',
            textWhite:   '#f0f5ff',
            textWin:     '#66ddcc',
            textLoss:    '#ff7788',
            textPrimary: '#b0d0e4',
            embedColor:  0x3a5a70,
        },
    ),

    royalPurple: colorway('royalPurple', 'Royal Purple',
        'Deep purple felt with gold frames. A premium combination.',
        10000, 60, '👑',
        {
            feltColor:   '#4b0082',
            feltDark:    '#2e0054',
            tableGreen:  '#6a0dad',
            gold:        '#ffd700',
            goldDark:    '#c8a830',
            goldBronze:  '#8b6914',
            textWhite:   '#ffffff',
            textWin:     '#66dd88',
            textLoss:    '#ff5566',
            textPrimary: '#ffd700',
            embedColor:  0x4b0082,
        },
    ),

    mocha: colorway('mocha', 'Mocha',
        'Rich espresso felt with creamy latte frames. Warm and smooth.',
        10000, 60, '☕',
        {
            feltColor:   '#2c1a0e',
            feltDark:    '#1a0f08',
            tableGreen:  '#3d2518',
            gold:        '#e8d5c0',
            goldDark:    '#c4a882',
            goldBronze:  '#8c6a48',
            textWhite:   '#f5ede4',
            textWin:     '#88c47a',
            textLoss:    '#d4665a',
            textPrimary: '#e8d5c0',
            embedColor:  0x2c1a0e,
        },
    ),

    // ── Test theme ──────────────────────────────────────────────────

    minimal: {
        id: 'minimal',
        name: 'Minimal Test',
        description: 'A theme that tests fallbacks by only defining one color.',
        tier: 'colorway',
        price: 0,
        weight: 0,
        emoji: '⬛',
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
            weight:      t.weight ?? 0,
            emoji:       t.emoji || '',
        }));
}

module.exports = { themes, getTheme, getAllThemes, getThemeList };
