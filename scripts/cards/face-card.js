const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

const CARD_W = 90;
const CARD_H = 135;
const BORDER_R = 6;
const PORTRAIT_X = 14;
const PORTRAIT_Y = 28;
const PORTRAIT_W = 62;
const PORTRAIT_H = 78;
const CORNER_MARGIN_X = 6;
const CORNER_MARGIN_Y = 10;
const SYMBOL_SIZE = 14;

const DEFAULT_FRAME_PATH = path.join(__dirname, '..', '..', 'assets', 'imgs', 'cards', 'templates', 'face-frame.png');

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
 * Draw a face card (J, Q, K) onto a destination context.
 * @param {CanvasRenderingContext2D} ctx — destination context
 * @param {number} x — blit x on destination
 * @param {number} y — blit y on destination
 * @param {string} rankDisplay — 'J','Q','K'
 * @param {Image} portraitImg — loaded portrait image
 * @param {Image} symbolImg — loaded suit symbol image
 * @param {Object} colors — { cardBorder, cardText }
 * @param {string} [customFramePath] — optional override frame PNG
 */
async function drawFaceCard(ctx, x, y, rankDisplay, portraitImg, symbolImg, colors, customFramePath) {
    const cardCanvas = createCanvas(CARD_W, CARD_H);
    const c = cardCanvas.getContext('2d');

    // Background
    c.fillStyle = '#ffffff';
    roundRect(c, 0, 0, CARD_W, CARD_H, BORDER_R);
    c.fill();

    c.strokeStyle = colors.cardBorder || '#cccccc';
    c.lineWidth = 1;
    roundRect(c, 0, 0, CARD_W, CARD_H, BORDER_R);
    c.stroke();

    c.save();
    roundRect(c, 0, 0, CARD_W, CARD_H, BORDER_R);
    c.clip();

    // Portrait (cover-fit into portrait area, clipped to rounded rect)
    if (portraitImg) {
        c.save();
        roundRect(c, PORTRAIT_X, PORTRAIT_Y, PORTRAIT_W, PORTRAIT_H, 4);
        c.clip();

        const scale = Math.max(PORTRAIT_W / portraitImg.width, PORTRAIT_H / portraitImg.height);
        const drawW = portraitImg.width * scale;
        const drawH = portraitImg.height * scale;
        const dx = PORTRAIT_X + (PORTRAIT_W - drawW) / 2;
        const dy = PORTRAIT_Y + (PORTRAIT_H - drawH) / 2;
        c.drawImage(portraitImg, dx, dy, drawW, drawH);
        c.restore();
    }

    // Frame overlay
    const framePath = customFramePath && fs.existsSync(customFramePath) ? customFramePath : DEFAULT_FRAME_PATH;
    if (fs.existsSync(framePath)) {
        const frameImg = await loadImage(framePath);
        c.drawImage(frameImg, 0, 0, CARD_W, CARD_H);
    }

    // Corner text
    c.fillStyle = colors.cardText || '#000000';
    c.font = `bold 14px "Times New Roman", serif`;
    c.textAlign = 'left';
    c.textBaseline = 'top';
    c.fillText(rankDisplay, CORNER_MARGIN_X, CORNER_MARGIN_Y);
    if (symbolImg) {
        c.drawImage(symbolImg, CORNER_MARGIN_X, CORNER_MARGIN_Y + 14, SYMBOL_SIZE, SYMBOL_SIZE);
    }

    c.save();
    c.translate(CARD_W - CORNER_MARGIN_X, CARD_H - CORNER_MARGIN_Y);
    c.rotate(Math.PI);
    c.fillText(rankDisplay, 0, 0);
    if (symbolImg) {
        c.drawImage(symbolImg, 0, 14, SYMBOL_SIZE, SYMBOL_SIZE);
    }
    c.restore();

    c.restore();

    ctx.drawImage(cardCanvas, x, y);
}

module.exports = { drawFaceCard };
