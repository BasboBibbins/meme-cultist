// Standard pip layouts for ranks A–10.
// Coordinates are normalized 0–1 within the card content area (excluding corners).
// The drawing code will convert these to pixel coords.

const PIP_LAYOUTS = {
    // Ace: oversized center pip
    A:  [{ x: 0.50, y: 0.52, scale: 2.6 }],

    // 2: top and bottom
    '2': [
        { x: 0.50, y: 0.22 },
        { x: 0.50, y: 0.78, rotate: 180 },
    ],

    // 3: top, center, bottom
    '3': [
        { x: 0.50, y: 0.22 },
        { x: 0.50, y: 0.52 },
        { x: 0.50, y: 0.78, rotate: 180 },
    ],

    // 4: four corners
    '4': [
        { x: 0.28, y: 0.22 },
        { x: 0.72, y: 0.22 },
        { x: 0.28, y: 0.78, rotate: 180 },
        { x: 0.72, y: 0.78, rotate: 180 },
    ],

    // 5: four corners + center
    '5': [
        { x: 0.28, y: 0.22 },
        { x: 0.72, y: 0.22 },
        { x: 0.50, y: 0.52 },
        { x: 0.28, y: 0.78, rotate: 180 },
        { x: 0.72, y: 0.78, rotate: 180 },
    ],

    // 6: two columns of three
    '6': [
        { x: 0.28, y: 0.22 },
        { x: 0.72, y: 0.22 },
        { x: 0.28, y: 0.52 },
        { x: 0.72, y: 0.52 },
        { x: 0.28, y: 0.78, rotate: 180 },
        { x: 0.72, y: 0.78, rotate: 180 },
    ],

    // 7: 6 layout + center-top
    '7': [
        { x: 0.28, y: 0.22 },
        { x: 0.72, y: 0.22 },
        { x: 0.50, y: 0.37 },
        { x: 0.28, y: 0.52 },
        { x: 0.72, y: 0.52 },
        { x: 0.28, y: 0.78, rotate: 180 },
        { x: 0.72, y: 0.78, rotate: 180 },
    ],

    // 8: two columns of four
    '8': [
        { x: 0.28, y: 0.18 },
        { x: 0.72, y: 0.18 },
        { x: 0.28, y: 0.40 },
        { x: 0.72, y: 0.40 },
        { x: 0.28, y: 0.62, rotate: 180 },
        { x: 0.72, y: 0.62, rotate: 180 },
        { x: 0.28, y: 0.84, rotate: 180 },
        { x: 0.72, y: 0.84, rotate: 180 },
    ],

    // 9: 8 layout + center
    '9': [
        { x: 0.28, y: 0.18 },
        { x: 0.72, y: 0.18 },
        { x: 0.28, y: 0.40 },
        { x: 0.72, y: 0.40 },
        { x: 0.50, y: 0.52 },
        { x: 0.28, y: 0.62, rotate: 180 },
        { x: 0.72, y: 0.62, rotate: 180 },
        { x: 0.28, y: 0.84, rotate: 180 },
        { x: 0.72, y: 0.84, rotate: 180 },
    ],

    // 10: 8 layout + two center
    '0': [ // 0 is the code for ten
        { x: 0.28, y: 0.18 },
        { x: 0.72, y: 0.18 },
        { x: 0.50, y: 0.34 },
        { x: 0.28, y: 0.42 },
        { x: 0.72, y: 0.42 },
        { x: 0.28, y: 0.62, rotate: 180 },
        { x: 0.72, y: 0.62, rotate: 180 },
        { x: 0.50, y: 0.70, rotate: 180 },
        { x: 0.28, y: 0.84, rotate: 180 },
        { x: 0.72, y: 0.84, rotate: 180 },
    ],
};

/**
 * Convert normalized pip layout to pixel coordinates.
 * @param {string} rankCode — 'A','2'...'0' (0 = ten)
 * @param {number} cardW — card width in pixels
 * @param {number} cardH — card height in pixels
 * @returns {Array<{x, y, rotate, scale}>} pixel coords
 */
function getPipLayout(rankCode, cardW, cardH) {
    const layout = PIP_LAYOUTS[rankCode];
    if (!layout) return [];
    return layout.map(p => ({
        x: p.x * cardW,
        y: p.y * cardH,
        rotate: p.rotate || 0,
        scale: p.scale || 1,
    }));
}

module.exports = { PIP_LAYOUTS, getPipLayout };
