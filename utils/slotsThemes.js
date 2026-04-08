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
            { type: 'emoji', text: '\u{1F34E}', label: 'Apple' },
            { type: 'emoji', text: '\u{1F34A}', label: 'Orange' },
            { type: 'emoji', text: '\u{1F34B}', label: 'Lemon' },
            { type: 'emoji', text: '\u{1F347}', label: 'Grapes' },
            { type: 'emoji', text: '\u{1F352}', label: 'Cherry' },
            { type: 'emoji', text: '\u{1F514}', label: 'Bell' },
            {
                type: 'special', render: 'bar', label: 'BAR',
                gradientColors: ['#888', '#fff', '#888'],
                textColor: '#222', strokeColor: '#555',
            },
            {
                type: 'special', render: 'seven', label: 'Seven',
                fillColor: '#ff0000', glowColor: '#ffd700', strokeColor: '#ffd700',
            },
            {
                type: 'special', render: 'wild', label: 'WILD',
                gradientColors: ['#fff8dc', '#daa520'],
                strokeColor: '#8b6914', textColor: '#222',
            },
            {
                type: 'special', render: 'scatter', label: 'SCATTER',
                gradientColors: ['#ffffaa', '#ffd700'],
                strokeColor: '#c8a830', textColor: '#333', innerText: 'FREE',
            },
        ],
    },

    // ─── Neon Arcade ─────────────────────────────────────────────────
    neon: {
        id: 'neon',
        name: 'Neon Arcade',
        description: 'Cyberpunk neon glow on dark.',

        colors: {
            feltColor: '#0a0a2a',
            feltDark: '#050518',
            reelBackground: '#08081e',
            frameColor: '#00ffff',
            frameDarkColor: '#0088aa',
            frameBronze: '#ff00ff',
            dividerColor: '#1a1a4a',
            highlightWin: 'rgba(0, 255, 255, 0.5)',
            textPrimary: '#00ffff',
            textWhite: '#e0e0ff',
            textLoss: '#ff4488',
            textWin: '#44ffaa',
            bannerBackground: '#0a002a',
            bannerBackgroundEnd: '#060018',
            motionBlurOverlay: 'rgba(5, 5, 24, 0.5)',
            paylineColors: ['#ff0066', '#00ff99', '#00ccff', '#ff9900', '#cc44ff'],
        },

        symbols: [
            { type: 'emoji', text: '\u{1F34E}', label: 'Apple' },
            { type: 'emoji', text: '\u{1F34A}', label: 'Orange' },
            { type: 'emoji', text: '\u{1F34B}', label: 'Lemon' },
            { type: 'emoji', text: '\u{1F347}', label: 'Grapes' },
            { type: 'emoji', text: '\u{1F352}', label: 'Cherry' },
            { type: 'emoji', text: '\u{1F514}', label: 'Bell' },
            {
                type: 'special', render: 'bar', label: 'BAR',
                gradientColors: ['#444', '#00ffff', '#444'],
                textColor: '#050518', strokeColor: '#0088aa',
            },
            {
                type: 'special', render: 'seven', label: 'Seven',
                fillColor: '#00ffff', glowColor: '#ff00ff', strokeColor: '#ff00ff',
            },
            {
                type: 'special', render: 'wild', label: 'WILD',
                gradientColors: ['#ccffff', '#0088ff'],
                strokeColor: '#0044aa', textColor: '#050518',
            },
            {
                type: 'special', render: 'scatter', label: 'SCATTER',
                gradientColors: ['#ffccff', '#ff00ff'],
                strokeColor: '#aa0088', textColor: '#1a001a', innerText: 'FREE',
            },
        ],
    },

    // ─── Feudal Japan ─────────────────────────────────────────────────
    feudalJapan: {
        id: 'feudalJapan',
        name: 'Feudal Japan',
        description: 'Rich dark red and black felt with gold accents.',

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
            { type: 'image', path: path.join(ASSETS_BASE, 'feudalJapan', 'bamboo.png'), label: 'Bamboo' },
            { type: 'image', path: path.join(ASSETS_BASE, 'feudalJapan', 'torii.png'), label: 'Torii Gate' },
            { type: 'image', path: path.join(ASSETS_BASE, 'feudalJapan', 'hanafuda.png'), label: 'Hanafuda' },
            { type: 'image', path: path.join(ASSETS_BASE, 'feudalJapan', 'castle.png'), label: 'Castle' },
            { type: 'image', path: path.join(ASSETS_BASE, 'feudalJapan', 'blossom.png'), label: 'Blossom' },
            { type: 'image', path: path.join(ASSETS_BASE, 'feudalJapan', 'dolls.png'), label: 'Dolls' },
            { type: 'image', path: path.join(ASSETS_BASE, 'feudalJapan', 'katana.png'), label: 'Katana' },
            { type: 'image', path: path.join(ASSETS_BASE, 'feudalJapan', 'dragon.png'), label: 'Dragon' },
            { type: 'image', path: path.join(ASSETS_BASE, 'feudalJapan', 'fan.png'), label: 'Fan' },
            { type: 'image', path: path.join(ASSETS_BASE, 'feudalJapan', 'lantern.png'), label: 'Lantern' },
        ],
    },

    // ─── Mystic (image-based demo) ───────────────────────────────────
    mystic: {
        id: 'mystic',
        name: 'Mystic Realm',
        description: 'Dark arcane theme with custom symbols.',

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
            { type: 'image', path: path.join(ASSETS_BASE, 'mystic', 'apple.png'), label: 'Apple' },
            { type: 'image', path: path.join(ASSETS_BASE, 'mystic', 'orange.png'), label: 'Orange' },
            { type: 'image', path: path.join(ASSETS_BASE, 'mystic', 'lemon.png'), label: 'Lemon' },
            { type: 'image', path: path.join(ASSETS_BASE, 'mystic', 'grapes.png'), label: 'Grapes' },
            { type: 'image', path: path.join(ASSETS_BASE, 'mystic', 'cherry.png'), label: 'Cherry' },
            { type: 'image', path: path.join(ASSETS_BASE, 'mystic', 'bell.png'), label: 'Bell' },
            { type: 'image', path: path.join(ASSETS_BASE, 'mystic', 'bar.png'), label: 'BAR' },
            { type: 'image', path: path.join(ASSETS_BASE, 'mystic', 'seven.png'), label: 'Seven' },
            { type: 'image', path: path.join(ASSETS_BASE, 'mystic', 'wild.png'), label: 'WILD' },
            { type: 'image', path: path.join(ASSETS_BASE, 'mystic', 'scatter.png'), label: 'SCATTER' },
        ],
    }
};

/**
 * Get a theme by ID, falling back to classic if not found.
 */
function getTheme(themeId) {
    return themes[themeId] || themes.classic;
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
