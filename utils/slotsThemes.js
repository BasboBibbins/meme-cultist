const path = require('path');

/**
 * Slots theme definitions.
 *
 * Each theme is a self-contained visual config object. Game logic (weights,
 * multipliers, paylines) is NOT part of themes — those live in slots.js.
 *
 * Symbol types:
 *   'emoji'   — render text/emoji via ctx.fillText
 *   'special' — built-in renderer (bar, seven, wild, scatter) with custom colors
 *   'image'   — load a PNG from disk, draw centered/scaled in the cell
 *   'sprite'  — load a sprite sheet, draw the specified frame centered/scaled
 */

const ASSETS_BASE = path.join(__dirname, '..', 'assets', 'imgs', 'slots');

const themes = {

    // ─── Classic Casino (default) ────────────────────────────────────
    classic: {
        id: 'classic',
        name: 'Classic Casino',
        description: 'The default green felt casino look.',

        colors: {
            feltColor: '#0f4c25',
            feltDark: '#0a3a1a',
            reelBackground: '#0a2a14',
            frameColor: '#ffd700',
            frameDarkColor: '#c8a830',
            frameBronze: '#8b6914',
            dividerColor: '#1a6b35',
            highlightWin: 'rgba(255, 215, 0, 0.6)',
            textPrimary: '#ffd700',
            textWhite: '#ffffff',
            textLoss: '#ff4444',
            textWin: '#44ff44',
            bannerBackground: '#2a0a00',
            bannerBackgroundEnd: '#1a0600',
            motionBlurOverlay: 'rgba(10, 42, 20, 0.45)',
            paylineColors: ['#ff4444', '#44ff44', '#4488ff', '#ffaa00', '#ff44ff'],
        },

        symbols: [
            { type: 'sprite', path: path.join(ASSETS_BASE, 'default.png'), index: 0, label: 'Apple' },
            { type: 'sprite', path: path.join(ASSETS_BASE, 'default.png'), index: 1, label: 'Orange' },
            { type: 'sprite', path: path.join(ASSETS_BASE, 'default.png'), index: 2, label: 'Lemon' },
            { type: 'sprite', path: path.join(ASSETS_BASE, 'default.png'), index: 3, label: 'Grapes' },
            { type: 'sprite', path: path.join(ASSETS_BASE, 'default.png'), index: 4, label: 'Cherry' },
            { type: 'sprite', path: path.join(ASSETS_BASE, 'default.png'), index: 5, label: 'Bell' },
            { type: 'sprite', path: path.join(ASSETS_BASE, 'default.png'), index: 6, label: 'BAR' },
            { type: 'sprite', path: path.join(ASSETS_BASE, 'default.png'), index: 7, label: 'Seven' },
            { type: 'sprite', path: path.join(ASSETS_BASE, 'default.png'), index: 8, label: 'Wild' },
            { type: 'sprite', path: path.join(ASSETS_BASE, 'default.png'), index: 9, label: 'Free Spin' },
        ],
    },

    // ─── Neon Arcade ─────────────────────────────────────────────────
    neon: {
        id: 'neon',
        name: 'Neon Arcade',
        description: 'A vibrant neon theme with glowing symbols.',

        colors: {
            feltColor: '#1a0a2e',
            feltDark: '#0f0520',
            reelBackground: '#120828',
            frameColor: '#c0c0c0',
            frameDarkColor: '#808080',
            frameBronze: '#6a6a6a',
            dividerColor: '#2a1a4a',
            highlightWin: 'rgba(192, 192, 192, 0.5)',
            textPrimary: '#c0c0c0',
            textWhite: '#e0d8f0',
            textLoss: '#ff6688',
            textWin: '#88ffaa',
            bannerBackground: '#1a0030',
            bannerBackgroundEnd: '#0f001a',
            motionBlurOverlay: 'rgba(15, 5, 32, 0.5)',
            paylineColors: ['#ff5577', '#55ff99', '#5588ff', '#ffaa44', '#cc55ff'],
        },

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

    // ─── Feudal Japan ─────────────────────────────────────────────────
    feudalJapan: {
        id: 'feudalJapan',
        name: 'Feudal Japan',
        description: 'Traditional Japanese theme with feudal symbols.',

        colors: {
            feltColor: '#4a0000',
            feltDark: '#2a0000',
            reelBackground: '#1a0000',
            frameColor: '#ffd700',
            frameDarkColor: '#c8a830',
            frameBronze: '#8b6914',
            dividerColor: '#3a0000',
            highlightWin: 'rgba(255, 215, 0, 0.6)',
            textPrimary: '#ffd700',
            textWhite: '#ffffff',
            textLoss: '#ff4444',
            textWin: '#44ff44',
            bannerBackground: '#000000',
            bannerBackgroundEnd: '#1a0000',
            motionBlurOverlay: 'rgba(26, 0, 0, 0.5)',
            paylineColors: ['#ff0000', '#ffd700', '#ffffff', '#ffaa00', '#aa0000'],
        },

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

    // ─── Minimal Test Theme ──────────────────────────────────────────────
    minimal: {
        id: 'minimal',
        name: 'Minimal Test',
        description: 'A theme that tests fallbacks by only defining one color.',
        colors: {
            feltColor: '#ff00ff', // Neon Pink
        },
        // symbols is omitted to test fallback to classic
    },

    // ─── Color-Based Themes ────────────────────────────────────────────────

    midnight: {
        id: 'midnight',
        name: 'Midnight',
        description: 'Deep navy and silver. A sleek, cooler-toned alternative to classic.',
        colors: {
            feltColor: '#000033',
            feltDark: '#00001a',
            reelBackground: '#000022',
            frameColor: '#c0c0c0',
            frameDarkColor: '#808080',
            frameBronze: '#a0a0a0',
            dividerColor: '#000044',
            highlightWin: 'rgba(192, 192, 192, 0.6)',
            textPrimary: '#c0c0c0',
            textWhite: '#ffffff',
            textLoss: '#ff4444',
            textWin: '#44ff44',
            bannerBackground: '#000022',
            bannerBackgroundEnd: '#000011',
            motionBlurOverlay: 'rgba(0, 0, 34, 0.45)',
            paylineColors: ['#c0c0c0', '#ffffff', '#a0a0a0', '#808080', '#606060'],
        },
    },

    cherryPop: {
        id: 'cherryPop',
        name: 'Cherry Pop',
        description: 'Hot pink and white felt with red accents. Fun and arcade-y.',
        colors: {
            feltColor: '#ff69b4',
            feltDark: '#c71585',
            reelBackground: '#ffb6c1',
            frameColor: '#ff0000',
            frameDarkColor: '#b22222',
            frameBronze: '#ffc0cb',
            dividerColor: '#ff1493',
            highlightWin: 'rgba(255, 20, 147, 0.6)',
            textPrimary: '#ffffff',
            textWhite: '#ffffff',
            textLoss: '#8b0000',
            textWin: '#00ff00',
            bannerBackground: '#ff1493',
            bannerBackgroundEnd: '#c71585',
            motionBlurOverlay: 'rgba(255, 105, 180, 0.45)',
            paylineColors: ['#ff1493', '#ff69b4', '#ff0000', '#ffc0cb', '#ffb6c1'],
        },
    },

    emerald: {
        id: 'emerald',
        name: 'Emerald',
        description: 'Richer, deeper greens than Classic. A premium classic tier.',
        colors: {
            feltColor: '#004d00',
            feltDark: '#003300',
            reelBackground: '#002200',
            frameColor: '#ffd700',
            frameDarkColor: '#c8a830',
            frameBronze: '#8b6914',
            dividerColor: '#006600',
            highlightWin: 'rgba(255, 215, 0, 0.6)',
            textPrimary: '#ffd700',
            textWhite: '#ffffff',
            textLoss: '#ff4444',
            textWin: '#44ff44',
            bannerBackground: '#002200',
            bannerBackgroundEnd: '#001100',
            motionBlurOverlay: 'rgba(0, 77, 0, 0.45)',
            paylineColors: ['#00ff00', '#ffd700', '#ffffff', '#adff2f', '#006400'],
        },
    },

    ocean: {
        id: 'ocean',
        name: 'Ocean',
        description: 'Teal and deep blue felt with seafoam highlights.',
        colors: {
            feltColor: '#008080',
            feltDark: '#004d4d',
            reelBackground: '#003333',
            frameColor: '#ff7f50',
            frameDarkColor: '#cd853f',
            frameBronze: '#f4a460',
            dividerColor: '#00cccc',
            highlightWin: 'rgba(127, 255, 212, 0.6)',
            textPrimary: '#e0ffff',
            textWhite: '#ffffff',
            textLoss: '#ff4444',
            textWin: '#44ff44',
            bannerBackground: '#004d4d',
            bannerBackgroundEnd: '#002222',
            motionBlurOverlay: 'rgba(0, 128, 128, 0.45)',
            paylineColors: ['#00ffff', '#40e0d0', '#ffffff', '#afeeee', '#008080'],
        },
    },

    ember: {
        id: 'ember',
        name: 'Ember',
        description: 'Deep charcoal felt with orange and amber frame colors.',
        colors: {
            feltColor: '#333333',
            feltDark: '#1a1a1a',
            reelBackground: '#222222',
            frameColor: '#ff8c00',
            frameDarkColor: '#cc7a00',
            frameBronze: '#8b4513',
            dividerColor: '#444444',
            highlightWin: 'rgba(255, 140, 0, 0.6)',
            textPrimary: '#ffae42',
            textWhite: '#ffffff',
            textLoss: '#ff4444',
            textWin: '#44ff44',
            bannerBackground: '#442200',
            bannerBackgroundEnd: '#221100',
            motionBlurOverlay: 'rgba(50, 50, 50, 0.45)',
            paylineColors: ['#ff4500', '#ff8c00', '#ffa500', '#ffcc00', '#ffaa00'],
        },
    },

    frost: {
        id: 'frost',
        name: 'Frost',
        description: 'Icy pale blue and white with silver frames.',
        colors: {
            feltColor: '#afeaea',
            feltDark: '#b0e0e6',
            reelBackground: '#f0ffff',
            frameColor: '#c0c0c0',
            frameDarkColor: '#808080',
            frameBronze: '#a9a9a9',
            dividerColor: '#add8e6',
            highlightWin: 'rgba(0, 255, 255, 0.6)',
            textPrimary: '#4682b4',
            textWhite: '#ffffff',
            textLoss: '#ff4444',
            textWin: '#44ff44',
            bannerBackground: '#b0e0e6',
            bannerBackgroundEnd: '#87ceeb',
            motionBlurOverlay: 'rgba(224, 255, 255, 0.45)',
            paylineColors: ['#00ffff', '#afeeee', '#ffffff', '#b0c4de', '#add8e6'],
        },
    },

    royalPurple: {
        id: 'royalPurple',
        name: 'Royal Purple',
        description: 'Deep purple felt with gold frames. A premium combination.',
        colors: {
            feltColor: '#4b0082',
            feltDark: '#2e0054',
            reelBackground: '#3b006b',
            frameColor: '#ffd700',
            frameDarkColor: '#c8a830',
            frameBronze: '#8b6914',
            dividerColor: '#6a0dad',
            highlightWin: 'rgba(255, 215, 0, 0.6)',
            textPrimary: '#ffd700',
            textWhite: '#ffffff',
            textLoss: '#ff4444',
            textWin: '#44ff44',
            bannerBackground: '#2e0054',
            bannerBackgroundEnd: '#1a0033',
            motionBlurOverlay: 'rgba(75, 0, 130, 0.45)',
            paylineColors: ['#ffd700', '#ffffff', '#da70d6', '#ba55d3', '#9370db'],
        },
    },
};

/**
 * Get a theme by ID, falling back to classic if not found.
 */
function getTheme(themeId) {
    const theme = themes[themeId] || themes.classic;

    return {
        ...theme,
        colors: {
            ...themes.classic.colors,
            ...theme.colors,
        },
        symbols: (theme.symbols && theme.symbols.length > 0)
            ? [...theme.symbols]
            : [...themes.classic.symbols],
    };
}

/**
 * Get list of all available themes for autocomplete/display.
 */
function getThemeList() {
    return Object.values(themes).map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
    }));
}

module.exports = { themes, getTheme, getThemeList };
