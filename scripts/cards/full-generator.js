const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');
const { drawNumberCard } = require('./number-card');
const { drawFaceCard } = require('./face-card');
const { generateStyledCards, generateFallbackSymbol } = require('./styled-recolor');
const { splitSvgByRows } = require('./svg-row-splitter');

const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets', 'imgs', 'cards');
const GENERATED_DIR = path.join(ASSETS_DIR, 'generated');

const SUITS = ['CLUBS', 'DIAMONDS', 'HEARTS', 'SPADES'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'J', 'Q', 'K'];
const FACE_RANKS = ['J', 'Q', 'K'];

function rankDisplay(code) {
    return code === '0' ? '10' : code;
}

function themeAssetPath(themeId, ...parts) {
    return path.join(ASSETS_DIR, themeId, ...parts);
}

async function generateFullCards(theme, { force = false } = {}) {
    const themeId = theme.id;
    const sheetOut = path.join(GENERATED_DIR, `${themeId}.png`);
    const backOut = path.join(GENERATED_DIR, `${themeId}-back.png`);

    if (!force && fs.existsSync(sheetOut) && fs.existsSync(backOut)) {
        console.log(`[full] ${themeId}: already generated, skipping (use --force to override)`);
        return { sheet: sheetOut, back: backOut };
    }

    console.log(`[full] ${themeId}: generating...`);

    // Load suit symbols (custom or fallback to recolored classic)
    const { rowSvgs } = splitSvgByRows();
    const suitColors = [
        theme.colors?.cardClub    || theme.colors?.cardSecondary || theme.colors?.textBlack || '#000000',
        theme.colors?.cardDiamond || theme.colors?.cardAccent    || theme.colors?.gold       || '#ff0000',
        theme.colors?.cardHeart   || theme.colors?.cardAccent    || theme.colors?.gold       || '#ff0000',
        theme.colors?.cardSpade   || theme.colors?.cardSecondary || theme.colors?.textBlack || '#000000',
    ];

    const symbols = {};
    let usedFallbackSymbols = false;
    for (let i = 0; i < SUITS.length; i++) {
        const suit = SUITS[i];
        const p = themeAssetPath(themeId, 'symbols', `${suit.toLowerCase()}.png`);
        if (fs.existsSync(p)) {
            symbols[suit] = await loadImage(p);
        } else {
            console.log(`[full] ${themeId}: using fallback symbol for ${suit}`);
            symbols[suit] = await generateFallbackSymbol(rowSvgs[i], suitColors[i]);
            usedFallbackSymbols = true;
        }
    }
    if (usedFallbackSymbols) {
        console.log(`[full] ${themeId}: place custom symbols in ${themeAssetPath(themeId, 'symbols')} to override`);
    }

    // Load face portraits
    const portraits = {};
    const faceNames = { J: 'jack', Q: 'queen', K: 'king' };
    for (const rank of FACE_RANKS) {
        const p = themeAssetPath(themeId, 'faces', `${faceNames[rank]}.png`);
        if (!fs.existsSync(p)) {
            throw new Error(`Missing portrait asset: ${p}`);
        }
        portraits[rank] = await loadImage(p);
    }

    const colors = {
        cardBorder: theme.colors?.cardBorder || '#cccccc',
        cardText: theme.colors?.cardText || '#000000',
    };

    const customFrame = themeAssetPath(themeId, 'face-frame.png');
    const hasCustomFrame = fs.existsSync(customFrame);

    // Build spritesheet
    const sheetW = 1170; // 13 * 90
    const sheetH = 540;  // 4 * 135
    const sheetCanvas = createCanvas(sheetW, sheetH);
    const ctx = sheetCanvas.getContext('2d');

    for (let si = 0; si < SUITS.length; si++) {
        const suit = SUITS[si];
        const symbolImg = symbols[suit];
        for (let ri = 0; ri < RANKS.length; ri++) {
            const rank = RANKS[ri];
            const x = ri * 90;
            const y = si * 135;
            if (FACE_RANKS.includes(rank)) {
                await drawFaceCard(ctx, x, y, rank, portraits[rank], symbolImg, colors, hasCustomFrame ? customFrame : null);
            } else {
                drawNumberCard(ctx, x, y, rank, rankDisplay(rank), symbolImg, colors);
            }
        }
    }

    fs.writeFileSync(sheetOut, sheetCanvas.toBuffer('image/png'));
    console.log(`[full] ${themeId}: wrote ${sheetOut}`);

    // Back
    const customBack = themeAssetPath(themeId, 'back.png');
    if (fs.existsSync(customBack)) {
        const backImg = await loadImage(customBack);
        const backCanvas = createCanvas(120, 180);
        const bctx = backCanvas.getContext('2d');
        bctx.drawImage(backImg, 0, 0, 120, 180);
        fs.writeFileSync(backOut, backCanvas.toBuffer('image/png'));
    } else {
        // Fall back to recolored classic-back only
        const { generateBackOnly } = require('./styled-recolor');
        await generateBackOnly(themeId, theme.colors);
    }
    console.log(`[full] ${themeId}: wrote ${backOut}`);

    return { sheet: sheetOut, back: backOut };
}

module.exports = { generateFullCards };
