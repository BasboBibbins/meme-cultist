const { createCanvas } = require('canvas');
const { getPipLayout } = require('./pip-layouts');

const CARD_W = 90;
const CARD_H = 135;
const BORDER_R = 8;
const CORNER_MARGIN_X = 4;
const CORNER_MARGIN_Y = 6;
const SYMBOL_SIZE = 14; // destination size for corner suit symbol
const PIP_SIZE = 30;     // destination size for center pips

function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

/**
 * Draw a number card (A–10) onto a destination context.
 * @param {CanvasRenderingContext2D} ctx — destination context
 * @param {number} x — blit x on destination
 * @param {number} y — blit y on destination
 * @param {string} rankCode — 'A','2'...'0' (0 = ten)
 * @param {string} rankDisplay — 'A','2'...'10'
 * @param {Image} symbolImg — suit symbol image (loaded via canvas.loadImage)
 * @param {Object} colors — { cardBorder, cardText }
 */
function drawNumberCard(ctx, x, y, rankCode, rankDisplay, symbolImg, colors) {
    const cardCanvas = createCanvas(CARD_W, CARD_H);
    const c = cardCanvas.getContext('2d');

    // Background
    c.fillStyle = colors.cardBackground || '#ffffff';
    roundRect(c, 0, 0, CARD_W, CARD_H, BORDER_R);
    c.fill();

    // Border
    c.strokeStyle = colors.cardBorder || '#cccccc';
    c.lineWidth = 2;
    roundRect(c, 0, 0, CARD_W, CARD_H, BORDER_R);
    c.stroke();

    // Clip to rounded rect so nothing draws outside
    c.save();
    roundRect(c, 0, 0, CARD_W, CARD_H, BORDER_R);
    c.clip();

    // Center pips (draw first so corner text sits on top)
    const pips = getPipLayout(rankCode, CARD_W, CARD_H);
    for (const pip of pips) {
        const size = PIP_SIZE * pip.scale;
        const dx = pip.x - size / 2;
        const dy = pip.y - size / 2;
        c.save();
        c.translate(pip.x, pip.y);
        c.rotate((pip.rotate * Math.PI) / 180);
        c.translate(-pip.x, -pip.y);
        if (symbolImg) {
            c.drawImage(symbolImg, dx, dy, size, size);
        }
        c.restore();
    }

    const CORNER_CENTER_X = CORNER_MARGIN_X + SYMBOL_SIZE / 2;

    // Top-left corner: rank + small symbol (centered above one another)
    c.fillStyle = colors.cardText || '#000000';
    c.font = `bold 12px "Card Characters", serif`;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.fillText(rankDisplay, CORNER_CENTER_X, CORNER_MARGIN_Y);
    if (symbolImg) {
        c.drawImage(symbolImg, CORNER_CENTER_X - SYMBOL_SIZE / 2, CORNER_MARGIN_Y + 14, SYMBOL_SIZE, SYMBOL_SIZE);
    }

    // Bottom-right corner: rotated rank + symbol (mirror of top-left)
    c.save();
    c.translate(CARD_W - CORNER_CENTER_X, CARD_H - CORNER_MARGIN_Y);
    c.rotate(Math.PI);
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.fillText(rankDisplay, 0, 0);
    if (symbolImg) {
        c.drawImage(symbolImg, -SYMBOL_SIZE / 2, 14, SYMBOL_SIZE, SYMBOL_SIZE);
    }
    c.restore();

    c.restore();

    // Blit to destination
    ctx.drawImage(cardCanvas, x, y);
}

module.exports = { drawNumberCard };
