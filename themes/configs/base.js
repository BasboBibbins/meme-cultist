/**
 * Classic theme -- the default "green felt casino" look.
 *
 * Every color key used by any game is defined here so the resolver always
 * has a complete fallback.  Shared keys live in `colors`; game-specific
 * keys live in `overrides.<game>`.
 *
 * Resolver merge order (four layers):
 *   classic.colors -> classic.overrides[game] -> theme.colors -> theme.overrides[game]
 */

const path = require('path');

const ASSETS_BASE = path.join(__dirname, '..', '..', 'assets', 'imgs', 'slots');

module.exports = {
    id: 'classic',
    name: 'Classic Casino',
    description: 'The default green felt casino look.',
    tier: 'full',
    price: 0,
    weight: 0,
    emoji: '🎰',
    game: null,

    // ── Shared palette (colorway themes override these) ─────────────
    colors: {
        // Background image URL (or local path) for full themes. Set to null for solid color.
        // Recommended resolution: 1100x420 — this covers all three game canvases
        // (slots: 600x420, poker: 600x320, roulette: 1100x400) without cropping.
        background: null,
        feltColor:   '#0f4c25',
        feltDark:    '#0a3a1a',
        tableGreen:  '#1a6b35',
        gold:        '#ffd700',
        goldDark:    '#c8a830',
        goldBronze:  '#8b6914',
        textWhite:   '#ffffff',
        textBlack:   '#000000',
        textWin:     '#44ff44',
        textLoss:    '#ff4444',
        textPrimary: '#ffd700',
        embedColor:  0x0f4c25,
    },

    overrides: {
        // ── Slots ───────────────────────────────────────────────────
        slots: {
            reelBackground:     '#0a2a14',
            frameColor:         '#ffd700',
            frameDarkColor:     '#c8a830',
            frameBronze:        '#8b6914',
            dividerColor:       '#1a6b35',
            highlightWin:       'rgba(255, 215, 0, 0.6)',
            bannerBackground:   '#2a0a00',
            bannerBackgroundEnd:'#1a0600',
            motionBlurOverlay:  'rgba(10, 42, 20, 0.45)',
            paylineColors:      ['#ff4444', '#44ff44', '#4488ff', '#ffaa00', '#ff44ff'],

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

        // ── Roulette ────────────────────────────────────────────────
        roulette: {
            // Wheel wood ring (radial gradient stops)
            woodInner:    '#6b3a0f',
            woodMid:      '#4a2808',
            woodOuter:    '#2e1a05',
            goldRim:      '#c8a830',

            // Pocket colors
            pocketRed:    '#c0392b',
            pocketBlack:  '#1a1a1a',
            pocketGreen:  '#1a8a3f',

            // Center felt bowl (radial gradient stops)
            feltInner:    '#237a3d',
            feltMid:      '#1a6b35',
            feltOuter:    '#145228',

            // Spokes & hub
            spokeColor:   '#c8a830',
            hubLight:     '#f5e070',
            hubMid:       '#c8a830',
            hubDark:      '#8a6020',
            hubStroke:    '#f0d060',

            // Betting table
            zeroGreen:    '#27ae60',
            betArea:      '#1e7a3d',
            betBorder:    '#88aa88',
            numberRed:    '#c0392b',
            numberBlack:  '#1a1a1a',

            // Result overlay
            winnerHighlight: '#ffd700',
            resultOverlay:   'rgba(0,0,0,0.6)',
            resultBorder:    '#ffd700',
        },

        // ── Poker ───────────────────────────────────────────────────
        // Poker uses shared keys (feltColor, tableGreen, gold, goldDark).
        // No additional overrides needed for the classic look.
        poker: {},
    },
};
