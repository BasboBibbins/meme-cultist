const { createCanvas, loadImage } = require('canvas');
const { AttachmentBuilder } = require('discord.js');
const GIFEncoder = require('gif-encoder');
const { CURRENCY_NAME } = require('../config.js');
const { getTheme } = require('./slotsThemes');
const CanvasUtil = require('./Canvas');

// Payline definitions (game logic, not themed)
const PAYLINES = [
    [[0, 0], [0, 1], [0, 2]],  // Line 1: top row
    [[1, 0], [1, 1], [1, 2]],  // Line 2: middle row
    [[2, 0], [2, 1], [2, 2]],  // Line 3: bottom row
    [[0, 0], [1, 1], [2, 2]],  // Line 4: diagonal down
    [[2, 0], [1, 1], [0, 2]],  // Line 5: diagonal up
];

// Fallback payline colors (used if theme doesn't provide them)
const PAYLINE_COLORS = [
    '#ff4444', '#44ff44', '#4488ff', '#ffaa00', '#ff44ff',
];

// ─── Image cache for image-based themes ──────────────────────────────

const imageCache = new Map();

async function preloadThemeImages(theme) {
    for (const sym of theme.symbols) {
        if ((sym.type === 'image' || sym.type === 'sprite') && !imageCache.has(sym.path)) {
            try {
                imageCache.set(sym.path, await loadImage(sym.path));
            } catch (err) {
                // Image failed to load — drawSymbol will fall back to label text
            }
        }
    }
}

// ─── Layout helper ───────────────────────────────────────────────────

function getLayout(theme) {
    const W = theme.canvas?.width || 600;
    const H = theme.canvas?.height || 420;
    const FRAME_X = 40;
    const FRAME_Y = 70;
    const FRAME_W = W - 80;
    const FRAME_H = H - 150;
    const CELL_W = Math.floor(FRAME_W / 3);
    const CELL_H = Math.floor(FRAME_H / 3);
    return { W, H, FRAME_X, FRAME_Y, FRAME_W, FRAME_H, CELL_W, CELL_H };
}

function getPaylineColors(theme) {
    return theme.colors.paylineColors || PAYLINE_COLORS;
}

// ─── Shape helpers ───────────────────────────────────────────────────

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

function drawStar(ctx, cx, cy, spikes, outerR, innerR) {
    let rot = Math.PI / 2 * 3;
    const step = Math.PI / spikes;
    ctx.beginPath();
    ctx.moveTo(cx, cy - outerR);
    for (let i = 0; i < spikes; i++) {
        ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
        rot += step;
        ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
        rot += step;
    }
    ctx.lineTo(cx, cy - outerR);
    ctx.closePath();
}

// ─── Symbol rendering ────────────────────────────────────────────────

function drawSymbol(ctx, symbolIndex, cx, cy, size, theme) {
    const sym = theme.symbols[symbolIndex];
    if (!sym) return;

    if (sym.type === 'sprite') {
        const img = imageCache.get(sym.path);
        if (img) {
            const bounds = CanvasUtil.calculateSpriteBounds(ctx, sym, size);
            ctx.drawImage(
                img,
                bounds.sx, bounds.sy, bounds.sWidth, bounds.sHeight,
                cx - bounds.dWidth / 2, cy - bounds.dHeight / 2,
                bounds.dWidth, bounds.dHeight
            );
        } else {
            // Fallback: render label text
            ctx.save();
            ctx.font = `bold ${Math.floor(size * 0.25)}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = theme.colors.textWhite;
            ctx.fillText(sym.label, cx, cy);
            ctx.restore();
        }
        return;
    }

    if (sym.type === 'image') {
        const img = imageCache.get(sym.path);
        if (img) {
            const drawSize = size * 0.7;
            ctx.drawImage(img, cx - drawSize / 2, cy - drawSize / 2, drawSize, drawSize);
        } else {
            // Fallback: render label text
            ctx.save();
            ctx.font = `bold ${Math.floor(size * 0.25)}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = theme.colors.textWhite;
            ctx.fillText(sym.label, cx, cy);
            ctx.restore();
        }
        return;
    }

    if (sym.type === 'special') {
        switch (sym.render) {
            case 'bar': drawBar(ctx, cx, cy, size, sym); break;
            case 'seven': drawSeven(ctx, cx, cy, size, sym); break;
            case 'wild': drawWild(ctx, cx, cy, size, sym); break;
            case 'scatter': drawScatter(ctx, cx, cy, size, sym); break;
        }
        return;
    }

    // Default: emoji text
    ctx.save();
    ctx.font = `${Math.floor(size * 0.55)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sym.text, cx, cy);
    ctx.restore();
}

function drawBar(ctx, cx, cy, size, sym) {
    ctx.save();
    const bw = size * 0.8, bh = size * 0.4;
    const colors = sym.gradientColors || ['#888', '#fff', '#888'];
    const gradient = ctx.createLinearGradient(cx - bw / 2, cy - bh / 2, cx - bw / 2, cy + bh / 2);
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(0.5, colors[1]);
    gradient.addColorStop(1, colors[2]);
    roundRect(ctx, cx - bw / 2, cy - bh / 2, bw, bh, 6);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = sym.strokeColor || '#555';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = sym.textColor || '#222';
    ctx.font = `bold ${Math.floor(size * 0.3)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BAR', cx, cy + 1);
    ctx.restore();
}

function drawSeven(ctx, cx, cy, size, sym) {
    ctx.save();
    ctx.font = `bold ${Math.floor(size * 0.7)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = sym.fillColor || '#ff0000';
    ctx.shadowColor = sym.glowColor || '#ffd700';
    ctx.shadowBlur = 8;
    ctx.fillText('7', cx, cy);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = sym.strokeColor || '#ffd700';
    ctx.lineWidth = 1.5;
    ctx.strokeText('7', cx, cy);
    ctx.restore();
}

function drawWild(ctx, cx, cy, size, sym) {
    ctx.save();
    const wr = size * 0.35;
    ctx.beginPath();
    ctx.arc(cx, cy, wr, 0, Math.PI * 2);
    const colors = sym.gradientColors || ['#fff8dc', '#daa520'];
    const gradient = ctx.createRadialGradient(cx, cy, wr * 0.2, cx, cy, wr);
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(1, colors[1]);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = sym.strokeColor || '#8b6914';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = sym.textColor || '#222';
    ctx.font = `bold ${Math.floor(size * 0.22)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('WILD', cx, cy + 1);
    ctx.restore();
}

function drawScatter(ctx, cx, cy, size, sym) {
    ctx.save();
    const starR = size * 0.35;
    drawStar(ctx, cx, cy, 5, starR, starR * 0.5);
    const colors = sym.gradientColors || ['#ffffaa', '#ffd700'];
    const gradient = ctx.createRadialGradient(cx, cy, starR * 0.2, cx, cy, starR);
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(1, colors[1]);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = sym.strokeColor || '#c8a830';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = sym.textColor || '#333';
    ctx.font = `bold ${Math.floor(size * 0.15)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sym.innerText || 'FREE', cx, cy + 1);
    ctx.restore();
}

// ─── Frame and grid drawing ──────────────────────────────────────────

function drawFrame(ctx, jackpotDisplay, activeLines, bet, isBonus, isFreePlay, theme, layout) {
    const { W, H, FRAME_X, FRAME_Y, FRAME_W, FRAME_H, CELL_W, CELL_H } = layout;
    const c = theme.colors;
    const plColors = getPaylineColors(theme);

    // Background
    ctx.fillStyle = c.feltDark;
    ctx.fillRect(0, 0, W, H);

    // Main felt area
    roundRect(ctx, 10, 10, W - 20, H - 20, 16);
    ctx.fillStyle = c.feltColor;
    ctx.fill();

    // Outer frame
    roundRect(ctx, 10, 10, W - 20, H - 20, 16);
    ctx.strokeStyle = c.frameColor;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Inner frame around reels
    roundRect(ctx, FRAME_X - 6, FRAME_Y - 6, FRAME_W + 12, FRAME_H + 12, 10);
    ctx.strokeStyle = c.frameDarkColor;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Reel background
    roundRect(ctx, FRAME_X, FRAME_Y, FRAME_W, FRAME_H, 6);
    ctx.fillStyle = c.reelBackground;
    ctx.fill();

    // Grid dividers
    ctx.strokeStyle = c.dividerColor;
    ctx.lineWidth = 1.5;
    for (let col = 1; col < 3; col++) {
        const x = FRAME_X + col * CELL_W;
        ctx.beginPath();
        ctx.moveTo(x, FRAME_Y);
        ctx.lineTo(x, FRAME_Y + FRAME_H);
        ctx.stroke();
    }
    for (let row = 1; row < 3; row++) {
        const y = FRAME_Y + row * CELL_H;
        ctx.beginPath();
        ctx.moveTo(FRAME_X, y);
        ctx.lineTo(FRAME_X + FRAME_W, y);
        ctx.stroke();
    }

    // Jackpot banner
    roundRect(ctx, 120, 16, 360, 42, 8);
    const bannerGrad = ctx.createLinearGradient(120, 16, 120, 58);
    bannerGrad.addColorStop(0, c.bannerBackground);
    bannerGrad.addColorStop(1, c.bannerBackgroundEnd);
    ctx.fillStyle = bannerGrad;
    ctx.fill();
    ctx.strokeStyle = c.frameColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = 'bold 12px Arial';
    ctx.fillStyle = c.textPrimary;
    ctx.textAlign = 'center';
    ctx.fillText('PROGRESSIVE JACKPOT', W / 2, 32);
    ctx.font = 'bold 16px Arial';
    ctx.fillText(jackpotDisplay, W / 2, 51);

    // Bonus indicator
    if (isBonus || isFreePlay) {
        ctx.font = 'bold 14px Arial';
        ctx.fillStyle = c.frameBronze;
        ctx.textAlign = 'center';
        ctx.fillText(isFreePlay ? 'DAILY FREE PLAY' : '\u2B50 BONUS FREE SPINS \u2B50', W / 2, FRAME_Y + FRAME_H + 22);
    }

    // Payline indicators
    for (let i = 0; i < 5; i++) {
        const active = i < activeLines;
        const y = FRAME_Y + 15 + i * 18;
        ctx.beginPath();
        ctx.arc(FRAME_X - 18, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = active ? plColors[i] : '#333';
        ctx.fill();
        if (active) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        ctx.font = '10px Arial';
        ctx.fillStyle = active ? '#fff' : '#555';
        ctx.textAlign = 'center';
        ctx.fillText(`${i + 1}`, FRAME_X - 18, y + 3.5);
    }

    // Bet info
    ctx.font = '14px Arial';
    ctx.fillStyle = c.textWhite;
    ctx.textAlign = 'left';
    ctx.fillText(`Bet: ${bet} ${CURRENCY_NAME} x ${activeLines} line${activeLines > 1 ? 's' : ''} = ${bet * activeLines} ${CURRENCY_NAME}`, 30, H - 20);
}

function drawGrid(ctx, grid, theme, layout) {
    const { FRAME_X, FRAME_Y, CELL_W, CELL_H } = layout;
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
            const cx = FRAME_X + col * CELL_W + CELL_W / 2;
            const cy = FRAME_Y + row * CELL_H + CELL_H / 2;
            drawSymbol(ctx, grid[row][col], cx, cy, Math.min(CELL_W, CELL_H), theme);
        }
    }
}

function drawWinningLines(ctx, winResults, activeLines, theme, layout) {
    const { FRAME_X, FRAME_Y, CELL_W, CELL_H } = layout;
    const plColors = getPaylineColors(theme);

    for (const win of winResults) {
        if (win.line >= activeLines) continue;
        const lineIdx = win.line;
        const positions = PAYLINES[lineIdx];

        ctx.save();
        ctx.strokeStyle = plColors[lineIdx];
        ctx.lineWidth = 3;
        ctx.shadowColor = plColors[lineIdx];
        ctx.shadowBlur = 6;
        ctx.setLineDash([]);
        ctx.beginPath();
        for (let i = 0; i < positions.length; i++) {
            const [row, col] = positions[i];
            const x = FRAME_X + col * CELL_W + CELL_W / 2;
            const y = FRAME_Y + row * CELL_H + CELL_H / 2;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Disable shadow before drawing highlights
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;

        // Highlight paying symbols only
        for (let i = 0; i < win.count; i++) {
            const [row, col] = positions[i];
            const x = FRAME_X + col * CELL_W;
            const y = FRAME_Y + row * CELL_H;
            ctx.fillStyle = theme.colors.highlightWin;
            ctx.fillRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);
        }
        ctx.restore();
    }
}

function drawResultText(ctx, totalWin, balance, isBonus, isFreePlay, bonusSpinsLeft, theme, layout) {
    const { W, H } = layout;
    const c = theme.colors;
    const y = H - 42;
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    if (totalWin > 0) {
        ctx.fillStyle = c.textWin;
        ctx.fillText(`WIN: ${totalWin.toLocaleString()} ${CURRENCY_NAME}`, W / 2, y);
    } else {
        ctx.fillStyle = c.textLoss;
        ctx.fillText('No win', W / 2, y);
    }

    ctx.font = '13px Arial';
    ctx.fillStyle = c.textWhite;
    let bottomText = `Balance: ${balance.toLocaleString()} ${CURRENCY_NAME}`;
    if (isBonus && bonusSpinsLeft > 0) {
        bottomText += `  |  Bonus spins left: ${bonusSpinsLeft}`;
    }
    if (isFreePlay) {
        bottomText += `  |  Daily free play spin${bonusSpinsLeft > 0 ? 's' : ''} used`;
    }
    ctx.textAlign = 'right';
    ctx.fillText(bottomText, W - 30, H - 20);
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Draw the final slot machine result as a GIF.
 * Winning lines blink on/off. No wins = static single-frame GIF.
 */
async function drawSlotMachine(grid, options = {}) {
    const {
        jackpotDisplay = '0 koku',
        activeLines = 1,
        bet = 0,
        totalWin = 0,
        balance = 0,
        winResults = [],
        isBonus = false,
        isFreePlay = false,
        bonusSpinsLeft = 0,
        theme: themeOverride,
    } = options;

    const theme = themeOverride || getTheme('classic');
    const layout = getLayout(theme);
    await preloadThemeImages(theme);

    const canvas = createCanvas(layout.W, layout.H);
    const ctx = canvas.getContext('2d');

    const encoder = new GIFEncoder(layout.W, layout.H);
    encoder.setRepeat(0);
    encoder.writeHeader();
    encoder.setQuality(10);

    const buffChunks = [];
    encoder.on('data', chunk => buffChunks.push(chunk));

    const hasWins = winResults.length > 0;

    if (!hasWins) {
        drawFrame(ctx, jackpotDisplay, activeLines, bet, isBonus, isFreePlay, theme, layout);
        drawGrid(ctx, grid, theme, layout);
        drawResultText(ctx, totalWin, balance, isBonus, isFreePlay, bonusSpinsLeft, theme, layout);
        encoder.setDelay(1000);
        encoder.addFrame(ctx.getImageData(0, 0, layout.W, layout.H).data);
    } else {
        const blinkCycles = 3;
        for (let cycle = 0; cycle < blinkCycles; cycle++) {
            drawFrame(ctx, jackpotDisplay, activeLines, bet, isBonus, isFreePlay, theme, layout);
            drawGrid(ctx, grid, theme, layout);
            drawWinningLines(ctx, winResults, activeLines, theme, layout);
            drawResultText(ctx, totalWin, balance, isBonus, isFreePlay, bonusSpinsLeft, theme, layout);
            encoder.setDelay(400);
            encoder.addFrame(ctx.getImageData(0, 0, layout.W, layout.H).data);

            drawFrame(ctx, jackpotDisplay, activeLines, bet, isBonus, isFreePlay, theme, layout);
            drawGrid(ctx, grid, theme, layout);
            drawResultText(ctx, totalWin, balance, isBonus, isFreePlay, bonusSpinsLeft, theme, layout);
            encoder.setDelay(250);
            encoder.addFrame(ctx.getImageData(0, 0, layout.W, layout.H).data);
        }

        drawFrame(ctx, jackpotDisplay, activeLines, bet, isBonus, isFreePlay, theme, layout);
        drawGrid(ctx, grid, theme, layout);
        drawWinningLines(ctx, winResults, activeLines, theme, layout);
        drawResultText(ctx, totalWin, balance, isBonus, isFreePlay, bonusSpinsLeft, theme, layout);
        encoder.setDelay(2000);
        encoder.addFrame(ctx.getImageData(0, 0, layout.W, layout.H).data);
    }

    encoder.finish();
    const output = Buffer.concat(buffChunks);
    return new AttachmentBuilder(output, { name: 'slots-result.gif' });
}

/**
 * Draw a spinning animation as a GIF, ending on the final grid.
 */
async function drawSpinAnimation(finalGrid, options = {}) {
    const {
        jackpotDisplay = '0 koku',
        activeLines = 1,
        bet = 0,
        theme: themeOverride,
    } = options;

    const theme = themeOverride || getTheme('classic');
    const layout = getLayout(theme);
    await preloadThemeImages(theme);

    const canvas = createCanvas(layout.W, layout.H);
    const ctx = canvas.getContext('2d');

    const encoder = new GIFEncoder(layout.W, layout.H);
    encoder.setRepeat(-1); // play once, no loop
    encoder.writeHeader();
    encoder.setQuality(10);

    const buffChunks = [];
    encoder.on('data', chunk => buffChunks.push(chunk));

    const totalFrames = 18;
    const lockFrames = [6, 11, 16];
    const symCount = theme.symbols.length;

    for (let frame = 0; frame < totalFrames; frame++) {
        drawFrame(ctx, jackpotDisplay, activeLines, bet, false, false, theme, layout);

        for (let col = 0; col < 3; col++) {
            const lockFrame = lockFrames[col];
            const locked = frame >= lockFrame;

            for (let row = 0; row < 3; row++) {
                const cx = layout.FRAME_X + col * layout.CELL_W + layout.CELL_W / 2;
                const cy = layout.FRAME_Y + row * layout.CELL_H + layout.CELL_H / 2;

                if (locked) {
                    drawSymbol(ctx, finalGrid[row][col], cx, cy, Math.min(layout.CELL_W, layout.CELL_H), theme);
                } else {
                    const randomSym = Math.floor(Math.random() * symCount);
                    ctx.save();
                    ctx.globalAlpha = 0.4;
                    drawSymbol(ctx, randomSym, cx, cy, Math.min(layout.CELL_W, layout.CELL_H), theme);
                    ctx.globalAlpha = 1.0;
                    ctx.fillStyle = theme.colors.motionBlurOverlay;
                    ctx.fillRect(
                        layout.FRAME_X + col * layout.CELL_W + 1,
                        layout.FRAME_Y + row * layout.CELL_H + 1,
                        layout.CELL_W - 2,
                        layout.CELL_H - 2
                    );
                    ctx.restore();
                }
            }
        }

        const isLastFrame = frame === totalFrames - 1;
        encoder.setDelay(isLastFrame ? 3000 : 120);
        encoder.addFrame(ctx.getImageData(0, 0, layout.W, layout.H).data);
    }

    encoder.finish();
    const output = Buffer.concat(buffChunks);
    return new AttachmentBuilder(output, { name: 'slots-spin.gif' });
}

/**
 * Draw the paytable as a static PNG image.
 */
async function drawPaytable(jackpotDisplay, symbolTable, theme) {
    theme = theme || getTheme('classic');
    await preloadThemeImages(theme);
    const c = theme.colors;
    const plColors = getPaylineColors(theme);

    const PT_W = 650;
    const PADDING = 20;
    const displayOrder = [...symbolTable].reverse();

    // Compute layout heights
    const titleY = 38;
    const bannerTop = 50;
    const bannerH = 28;
    const symbolStartY = bannerTop + bannerH + 16;
    const symbolRowH = 32;
    const symbolSectionH = displayOrder.length * symbolRowH;
    const plTitleY = symbolStartY + symbolSectionH + 18;
    const plLabelY = plTitleY + 24;
    const plGridY = plLabelY + 16;
    const miniCell = 16;
    const miniGridH = 3 * miniCell;
    const rulesY = plGridY + miniGridH + 16;
    const PT_H = rulesY + 36 + PADDING;

    const canvas = createCanvas(PT_W, PT_H);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = c.feltDark;
    ctx.fillRect(0, 0, PT_W, PT_H);
    roundRect(ctx, 8, 8, PT_W - 16, PT_H - 16, 12);
    ctx.fillStyle = c.feltColor;
    ctx.fill();
    ctx.strokeStyle = c.frameColor;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Title
    ctx.font = 'bold 22px Arial';
    ctx.fillStyle = c.textPrimary;
    ctx.textAlign = 'center';
    ctx.fillText('SLOTS PAYTABLE', PT_W / 2, titleY);

    // Jackpot banner
    const bannerW = 340;
    const bannerX = (PT_W - bannerW) / 2;
    roundRect(ctx, bannerX, bannerTop, bannerW, bannerH, 6);
    ctx.fillStyle = c.bannerBackground;
    ctx.fill();
    ctx.strokeStyle = c.frameColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.font = 'bold 13px Arial';
    ctx.fillStyle = c.textPrimary;
    ctx.fillText(`PROGRESSIVE JACKPOT: ${jackpotDisplay}`, PT_W / 2, bannerTop + 18);

    // Symbol payouts
    ctx.textAlign = 'left';
    for (let i = 0; i < displayOrder.length; i++) {
        const sym = displayOrder[i];
        const y = symbolStartY + i * symbolRowH + symbolRowH / 2;

        drawSymbol(ctx, sym.index, 46, y, 26, theme);

        ctx.font = 'bold 13px Arial';
        ctx.fillStyle = c.textWhite;

        const themeSym = theme.symbols[sym.index];
        ctx.fillText(themeSym?.label || sym.name || 'Symbol', 74, y + 4);

        ctx.font = '12px Arial';
        if (sym.index === 7) {
            ctx.fillStyle = c.textWin;
            ctx.fillText(`3-match: JACKPOT  |  2-match: ${sym.partial}x`, 160, y + 4);
        } else if (sym.index === 8) {
            ctx.fillStyle = c.textPrimary;
            ctx.fillText('Substitutes for any symbol (except Scatter)', 160, y + 4);
        } else if (sym.index === 9) {
            ctx.fillStyle = c.textPrimary;
            ctx.fillText('3+ anywhere = Bonus Free Spins (2x multiplier)', 160, y + 4);
        } else {
            ctx.fillStyle = c.textWin;
            ctx.fillText(`3-match: ${sym.multiplier}x  |  2-match: ${sym.partial}x`, 160, y + 4);
        }
    }

    // Separator
    ctx.strokeStyle = c.frameDarkColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PADDING + 20, plTitleY - 8);
    ctx.lineTo(PT_W - PADDING - 20, plTitleY - 8);
    ctx.stroke();

    // Paylines title
    ctx.font = 'bold 16px Arial';
    ctx.fillStyle = c.textPrimary;
    ctx.textAlign = 'center';
    ctx.fillText('PAYLINES', PT_W / 2, plTitleY + 6);

    const lineNames = ['Top Row', 'Middle Row', 'Bottom Row', 'Diagonal Down', 'Diagonal Up'];
    const miniGridW = 3 * miniCell;
    const colCount = 5;
    const colW = (PT_W - PADDING * 2) / colCount;

    for (let i = 0; i < colCount; i++) {
        const colCenterX = PADDING + colW * i + colW / 2;
        const gridLeft = colCenterX - miniGridW / 2;

        ctx.font = '11px Arial';
        const label = `${i + 1}: ${lineNames[i]}`;
        const labelW = ctx.measureText(label).width;
        const dotX = colCenterX - labelW / 2 - 8;

        ctx.beginPath();
        ctx.arc(dotX, plLabelY + 1, 4, 0, Math.PI * 2);
        ctx.fillStyle = plColors[i];
        ctx.fill();

        ctx.fillStyle = c.textWhite;
        ctx.textAlign = 'center';
        ctx.fillText(label, colCenterX, plLabelY + 4);

        for (let r = 0; r < 3; r++) {
            for (let ci = 0; ci < 3; ci++) {
                const mx = gridLeft + ci * miniCell;
                const my = plGridY + r * miniCell;

                ctx.fillStyle = '#2a2a2a';
                ctx.fillRect(mx, my, miniCell - 1, miniCell - 1);

                const isOnLine = PAYLINES[i].some(([pr, pc]) => pr === r && pc === ci);
                if (isOnLine) {
                    ctx.fillStyle = plColors[i];
                    ctx.globalAlpha = 0.8;
                    ctx.fillRect(mx, my, miniCell - 1, miniCell - 1);
                    ctx.globalAlpha = 1.0;
                }
            }
        }
    }

    // Separator
    ctx.strokeStyle = c.frameDarkColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PADDING + 20, rulesY - 6);
    ctx.lineTo(PT_W - PADDING - 20, rulesY - 6);
    ctx.stroke();

    // Rules
    ctx.font = '11px Arial';
    ctx.fillStyle = '#aaaaaa';
    ctx.textAlign = 'center';
    ctx.fillText('Bet is per line. Total cost = bet \u00D7 lines. Default: 1 line (middle row).', PT_W / 2, rulesY + 6);
    ctx.fillText('WILD substitutes for all symbols except SCATTER. 3+ SCATTER = Bonus Free Spins!', PT_W / 2, rulesY + 22);

    const buffer = canvas.toBuffer('image/png');
    return new AttachmentBuilder(buffer, { name: 'paytable.png' });
}

module.exports = {
    drawSlotMachine,
    drawSpinAnimation,
    drawPaytable,
    PAYLINES,
    PAYLINE_COLORS,
};
