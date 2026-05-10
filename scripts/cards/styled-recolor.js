const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');
const { colorMap, recolorSvgStyle, injectDefaultFills } = require('./color-map');
const { splitSvgByRows } = require('./svg-row-splitter');

const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets', 'imgs', 'cards');
const GENERATED_DIR = path.join(ASSETS_DIR, 'generated');
const CLASSIC_BACK_SVG = path.join(ASSETS_DIR, 'svg', 'classic-back.svg');

const SHEET_W = 1170;
const SHEET_H = 540;
const ROW_H = 135;

// Ensure output dir exists
if (!fs.existsSync(GENERATED_DIR)) {
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

/**
 * Recolor a row-specific SVG string.
 * Replaces all red/black palette colors in the <style> block with the target suit color.
 */
function recolorRowSvg(rowSvg, suitColor) {
    const map = new Map();
    for (const old of colorMap.redPalette) {
        map.set(old, suitColor);
    }
    for (const old of colorMap.blackPalette) {
        map.set(old, suitColor);
    }
    const recolored = recolorSvgStyle(rowSvg, map);
    return injectDefaultFills(recolored, suitColor);
}

async function generateStyledCards(theme, { force = false } = {}) {
    const themeId = theme.id;
    const colors = theme.colors || {};

    // Four suit colors with fallbacks for backward compatibility
    const clubColor    = colors.cardClub    || colors.cardSecondary || colors.textBlack || '#000000';
    const diamondColor = colors.cardDiamond || colors.cardAccent    || colors.gold       || '#ff0000';
    const heartColor   = colors.cardHeart   || colors.cardAccent    || colors.gold       || '#ff0000';
    const spadeColor   = colors.cardSpade   || colors.cardSecondary || colors.textBlack || '#000000';

    const suitColors = [clubColor, diamondColor, heartColor, spadeColor];

    const sheetOut = path.join(GENERATED_DIR, `${themeId}.png`);
    const backOut = path.join(GENERATED_DIR, `${themeId}-back.png`);

    if (!force && fs.existsSync(sheetOut) && fs.existsSync(backOut)) {
        console.log(`[styled] ${themeId}: already generated, skipping (use --force to override)`);
        return { sheet: sheetOut, back: backOut };
    }

    console.log(`[styled] ${themeId}: generating`);
    console.log(`  clubs=${clubColor} diamonds=${diamondColor} hearts=${heartColor} spades=${spadeColor}`);

    // ── Sheet ──
    const { rowSvgs } = splitSvgByRows();
    const canvas = createCanvas(SHEET_W, SHEET_H);
    const ctx = canvas.getContext('2d');

    for (let i = 0; i < 4; i++) {
        const recolored = recolorRowSvg(rowSvgs[i], suitColors[i]);
        const buffer = Buffer.from(recolored, 'utf8');
        const img = await loadImage(buffer);
        ctx.drawImage(img, 0, i * ROW_H, SHEET_W, ROW_H);
    }

    fs.writeFileSync(sheetOut, canvas.toBuffer('image/png'));
    console.log(`[styled] ${themeId}: wrote ${sheetOut}`);

    // ── Back ──
    await generateBackOnly(themeId, colors);

    return { sheet: sheetOut, back: backOut };
}

async function generateBackOnly(themeId, colors) {
    const accent = colors?.cardDiamond || colors?.cardAccent || colors?.gold || '#ff0000';
    const backOut = path.join(GENERATED_DIR, `${themeId}-back.png`);

    console.log(`[styled] ${themeId}: generating back with accent=${accent}`);

    const backSvgText = fs.readFileSync(CLASSIC_BACK_SVG, 'utf8');
    const recoloredBackSvg = backSvgText
        .replace(/fill:\s*red\b/gi, `fill: ${accent}`)
        .replace(/stroke:\s*red\b/gi, `stroke: ${accent}`);

    const sizedBackSvg = recoloredBackSvg.replace(
        /viewBox="0 0 359 539"/,
        `viewBox="0 0 359 539" width="359" height="539"`
    );
    const backBuffer = Buffer.from(sizedBackSvg, 'utf8');
    const backImg = await loadImage(backBuffer);

    const backCanvas = createCanvas(120, 180);
    const backCtx = backCanvas.getContext('2d');
    backCtx.drawImage(backImg, 0, 0, 120, 180);
    fs.writeFileSync(backOut, backCanvas.toBuffer('image/png'));
    console.log(`[styled] ${themeId}: wrote ${backOut}`);
    return backOut;
}

// Native coordinates to crop the center pip from the Ace of each row
const SYMBOL_CROP = { x: 110, y: 180, w: 140, h: 180 };

/**
 * Generate a fallback suit symbol by cropping the center pip from the
 * recolored Ace (first card) of a row SVG.
 */
async function generateFallbackSymbol(rowSvg, suitColor) {
    const recolored = recolorRowSvg(rowSvg, suitColor);
    const rowCanvas = createCanvas(4680, 540);
    const rowCtx = rowCanvas.getContext('2d');
    const rowImg = await loadImage(Buffer.from(recolored, 'utf8'));
    rowCtx.drawImage(rowImg, 0, 0);

    const symCanvas = createCanvas(SYMBOL_CROP.w, SYMBOL_CROP.h);
    const sCtx = symCanvas.getContext('2d');
    sCtx.drawImage(
        rowCanvas,
        SYMBOL_CROP.x, SYMBOL_CROP.y, SYMBOL_CROP.w, SYMBOL_CROP.h,
        0, 0, SYMBOL_CROP.w, SYMBOL_CROP.h
    );

    return await loadImage(symCanvas.toBuffer('image/png'));
}

module.exports = { generateStyledCards, generateBackOnly, recolorRowSvg, generateFallbackSymbol };
