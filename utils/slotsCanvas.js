const { createCanvas } = require('canvas');
const { AttachmentBuilder } = require('discord.js');
const GIFEncoder = require('gif-encoder');
const { CURRENCY_NAME } = require('../config.js');

// Canvas dimensions
const CANVAS_W = 600;
const CANVAS_H = 420;

// Layout constants
const FRAME_X = 40;
const FRAME_Y = 70;
const FRAME_W = 520;
const FRAME_H = 270;
const CELL_W = Math.floor(FRAME_W / 3);
const CELL_H = Math.floor(FRAME_H / 3);

// Colors
const FELT_COLOR = '#0f4c25';
const FELT_DARK = '#0a3a1a';
const FRAME_GOLD = '#ffd700';
const FRAME_DARK_GOLD = '#c8a830';
const FRAME_BRONZE = '#8b6914';
const DIVIDER_COLOR = '#1a6b35';
const HIGHLIGHT_WIN = 'rgba(255, 215, 0, 0.6)';
const TEXT_GOLD = '#ffd700';
const TEXT_WHITE = '#ffffff';
const TEXT_RED = '#ff4444';
const TEXT_GREEN = '#44ff44';

// Symbol display mappings (for canvas text rendering)
const SYMBOL_DISPLAY = [
    { text: '\u{1F34E}', label: 'Apple', color: '#ff4444' },      // 0: apple
    { text: '\u{1F34A}', label: 'Orange', color: '#ff8c00' },     // 1: orange
    { text: '\u{1F34B}', label: 'Lemon', color: '#fff44f' },      // 2: lemon
    { text: '\u{1F347}', label: 'Grapes', color: '#9b59b6' },     // 3: grapes
    { text: '\u{1F352}', label: 'Cherry', color: '#dc143c' },     // 4: cherries
    { text: '\u{1F514}', label: 'Bell', color: '#ffd700' },       // 5: bell
    { text: 'BAR', label: 'BAR', color: '#ffffff' },              // 6: bar
    { text: '7', label: 'Seven', color: '#ff0000' },              // 7: seven
    { text: 'W', label: 'WILD', color: '#ffd700' },               // 8: wild
    { text: '\u{2B50}', label: 'SCATTER', color: '#ffff00' },     // 9: scatter
];

// Payline definitions: each is an array of [row, col] positions
const PAYLINES = [
    [[0, 0], [0, 1], [0, 2]],  // Line 1: top row
    [[1, 0], [1, 1], [1, 2]],  // Line 2: middle row
    [[2, 0], [2, 1], [2, 2]],  // Line 3: bottom row
    [[0, 0], [1, 1], [2, 2]],  // Line 4: diagonal down
    [[2, 0], [1, 1], [0, 2]],  // Line 5: diagonal up
];

const PAYLINE_COLORS = [
    '#ff4444', // red
    '#44ff44', // green
    '#4488ff', // blue
    '#ffaa00', // orange
    '#ff44ff', // pink
];

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

function drawSymbol(ctx, symbolIndex, cx, cy, size) {
    const sym = SYMBOL_DISPLAY[symbolIndex];
    if (symbolIndex === 6) {
        // BAR - draw as styled text block
        ctx.save();
        const bw = size * 0.8, bh = size * 0.4;
        const gradient = ctx.createLinearGradient(cx - bw / 2, cy - bh / 2, cx - bw / 2, cy + bh / 2);
        gradient.addColorStop(0, '#888');
        gradient.addColorStop(0.5, '#fff');
        gradient.addColorStop(1, '#888');
        roundRect(ctx, cx - bw / 2, cy - bh / 2, bw, bh, 6);
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#222';
        ctx.font = `bold ${Math.floor(size * 0.3)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('BAR', cx, cy + 1);
        ctx.restore();
    } else if (symbolIndex === 7) {
        // Lucky 7 - draw as stylized red 7
        ctx.save();
        ctx.font = `bold ${Math.floor(size * 0.7)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ff0000';
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = 8;
        ctx.fillText('7', cx, cy);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 1.5;
        ctx.strokeText('7', cx, cy);
        ctx.restore();
    } else if (symbolIndex === 8) {
        // WILD - gold badge
        ctx.save();
        const wr = size * 0.35;
        ctx.beginPath();
        ctx.arc(cx, cy, wr, 0, Math.PI * 2);
        const gradient = ctx.createRadialGradient(cx, cy, wr * 0.2, cx, cy, wr);
        gradient.addColorStop(0, '#fff8dc');
        gradient.addColorStop(1, '#daa520');
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.strokeStyle = '#8b6914';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#222';
        ctx.font = `bold ${Math.floor(size * 0.22)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('WILD', cx, cy + 1);
        ctx.restore();
    } else if (symbolIndex === 9) {
        // SCATTER - star
        ctx.save();
        const starR = size * 0.35;
        drawStar(ctx, cx, cy, 5, starR, starR * 0.5);
        const gradient = ctx.createRadialGradient(cx, cy, starR * 0.2, cx, cy, starR);
        gradient.addColorStop(0, '#ffffaa');
        gradient.addColorStop(1, '#ffd700');
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.strokeStyle = '#c8a830';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#333';
        ctx.font = `bold ${Math.floor(size * 0.15)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('FREE', cx, cy + 1);
        ctx.restore();
    } else {
        // Emoji fruit symbols - render as text
        ctx.save();
        ctx.font = `${Math.floor(size * 0.55)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(sym.text, cx, cy);
        ctx.restore();
    }
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

function drawFrame(ctx, jackpotDisplay, activeLines, bet, isBonus) {
    // Background
    ctx.fillStyle = FELT_DARK;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Main felt area
    roundRect(ctx, 10, 10, CANVAS_W - 20, CANVAS_H - 20, 16);
    ctx.fillStyle = FELT_COLOR;
    ctx.fill();

    // Gold outer frame
    roundRect(ctx, 10, 10, CANVAS_W - 20, CANVAS_H - 20, 16);
    ctx.strokeStyle = FRAME_GOLD;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Inner gold frame around reels
    roundRect(ctx, FRAME_X - 6, FRAME_Y - 6, FRAME_W + 12, FRAME_H + 12, 10);
    ctx.strokeStyle = FRAME_DARK_GOLD;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Reel background (darker)
    roundRect(ctx, FRAME_X, FRAME_Y, FRAME_W, FRAME_H, 6);
    ctx.fillStyle = '#0a2a14';
    ctx.fill();

    // Grid dividers
    ctx.strokeStyle = DIVIDER_COLOR;
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

    // Jackpot banner at top
    roundRect(ctx, 120, 16, 360, 42, 8);
    const bannerGrad = ctx.createLinearGradient(120, 16, 120, 58);
    bannerGrad.addColorStop(0, '#2a0a00');
    bannerGrad.addColorStop(1, '#1a0600');
    ctx.fillStyle = bannerGrad;
    ctx.fill();
    ctx.strokeStyle = FRAME_GOLD;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = 'bold 12px Arial';
    ctx.fillStyle = TEXT_GOLD;
    ctx.textAlign = 'center';
    ctx.fillText('PROGRESSIVE JACKPOT', 300, 32);
    ctx.font = 'bold 16px Arial';
    ctx.fillText(jackpotDisplay, 300, 51);

    // Bonus indicator
    if (isBonus) {
        ctx.font = 'bold 14px Arial';
        ctx.fillStyle = '#ff44ff';
        ctx.textAlign = 'center';
        ctx.fillText('\u2B50 BONUS FREE SPINS \u2B50', 300, FRAME_Y + FRAME_H + 22);
    }

    // Payline indicators on left margin
    for (let i = 0; i < 5; i++) {
        const active = i < activeLines;
        const y = FRAME_Y + 15 + i * 18;
        ctx.beginPath();
        ctx.arc(FRAME_X - 18, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = active ? PAYLINE_COLORS[i] : '#333';
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

    // Bet info at bottom
    ctx.font = '14px Arial';
    ctx.fillStyle = TEXT_WHITE;
    ctx.textAlign = 'left';
    ctx.fillText(`Bet: ${bet} ${CURRENCY_NAME} x ${activeLines} line${activeLines > 1 ? 's' : ''} = ${bet * activeLines} ${CURRENCY_NAME}`, 30, CANVAS_H - 20);
}

function drawGrid(ctx, grid) {
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
            const cx = FRAME_X + col * CELL_W + CELL_W / 2;
            const cy = FRAME_Y + row * CELL_H + CELL_H / 2;
            drawSymbol(ctx, grid[row][col], cx, cy, Math.min(CELL_W, CELL_H));
        }
    }
}

function drawWinningLines(ctx, winResults, activeLines) {
    for (const win of winResults) {
        if (win.line >= activeLines) continue;
        const lineIdx = win.line;
        const positions = PAYLINES[lineIdx];

        ctx.save();
        ctx.strokeStyle = PAYLINE_COLORS[lineIdx];
        ctx.lineWidth = 3;
        ctx.shadowColor = PAYLINE_COLORS[lineIdx];
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

        // Disable shadow before drawing highlights so alpha blending works
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;

        // Highlight only the symbols that are paying out (left-to-right match count)
        for (let i = 0; i < win.count; i++) {
            const [row, col] = positions[i];
            const x = FRAME_X + col * CELL_W;
            const y = FRAME_Y + row * CELL_H;
            ctx.fillStyle = HIGHLIGHT_WIN;
            ctx.fillRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);
        }
        ctx.restore();
    }
}

function drawResultText(ctx, totalWin, balance, isBonus, bonusSpinsLeft) {
    const y = CANVAS_H - 42;
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    if (totalWin > 0) {
        ctx.fillStyle = TEXT_GREEN;
        ctx.fillText(`WIN: ${totalWin.toLocaleString()} ${CURRENCY_NAME}`, 300, y);
    } else {
        ctx.fillStyle = TEXT_RED;
        ctx.fillText('No win', 300, y);
    }

    ctx.font = '13px Arial';
    ctx.fillStyle = TEXT_WHITE;
    let bottomText = `Balance: ${balance.toLocaleString()} ${CURRENCY_NAME}`;
    if (isBonus && bonusSpinsLeft > 0) {
        bottomText += `  |  Bonus spins left: ${bonusSpinsLeft}`;
    }
    ctx.textAlign = 'right';
    ctx.fillText(bottomText, CANVAS_W - 30, CANVAS_H - 20);
}

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
        bonusSpinsLeft = 0,
    } = options;

    const canvas = createCanvas(CANVAS_W, CANVAS_H);
    const ctx = canvas.getContext('2d');

    const encoder = new GIFEncoder(CANVAS_W, CANVAS_H);
    encoder.setRepeat(0);
    encoder.writeHeader();
    encoder.setQuality(10);

    const buffChunks = [];
    encoder.on('data', chunk => buffChunks.push(chunk));

    const hasWins = winResults.length > 0;

    if (!hasWins) {
        // Single frame, static result
        drawFrame(ctx, jackpotDisplay, activeLines, bet, isBonus);
        drawGrid(ctx, grid);
        drawResultText(ctx, totalWin, balance, isBonus, bonusSpinsLeft);
        encoder.setDelay(1000);
        encoder.addFrame(ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data);
    } else {
        // Blink cycle: 6 frames total (3 on, 3 off) for ~3 seconds, then hold with lines on
        const blinkCycles = 3;
        for (let cycle = 0; cycle < blinkCycles; cycle++) {
            // Frame with winning lines highlighted
            drawFrame(ctx, jackpotDisplay, activeLines, bet, isBonus);
            drawGrid(ctx, grid);
            drawWinningLines(ctx, winResults, activeLines);
            drawResultText(ctx, totalWin, balance, isBonus, bonusSpinsLeft);
            encoder.setDelay(400);
            encoder.addFrame(ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data);

            // Frame without winning lines (just grid)
            drawFrame(ctx, jackpotDisplay, activeLines, bet, isBonus);
            drawGrid(ctx, grid);
            drawResultText(ctx, totalWin, balance, isBonus, bonusSpinsLeft);
            encoder.setDelay(250);
            encoder.addFrame(ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data);
        }

        // Final frame: lines on, held longer
        drawFrame(ctx, jackpotDisplay, activeLines, bet, isBonus);
        drawGrid(ctx, grid);
        drawWinningLines(ctx, winResults, activeLines);
        drawResultText(ctx, totalWin, balance, isBonus, bonusSpinsLeft);
        encoder.setDelay(2000);
        encoder.addFrame(ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data);
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
    } = options;

    const canvas = createCanvas(CANVAS_W, CANVAS_H);
    const ctx = canvas.getContext('2d');

    const encoder = new GIFEncoder(CANVAS_W, CANVAS_H);
    encoder.setRepeat(0);
    encoder.writeHeader();
    encoder.setQuality(10);

    const buffChunks = [];
    encoder.on('data', chunk => buffChunks.push(chunk));

    const totalFrames = 18;
    const lockFrames = [6, 11, 16]; // frame where each reel locks (left, mid, right)

    for (let frame = 0; frame < totalFrames; frame++) {
        // Clear and draw frame
        drawFrame(ctx, jackpotDisplay, activeLines, bet, false);

        // Draw each reel column
        for (let col = 0; col < 3; col++) {
            const lockFrame = lockFrames[col];
            const locked = frame >= lockFrame;

            for (let row = 0; row < 3; row++) {
                const cx = FRAME_X + col * CELL_W + CELL_W / 2;
                const cy = FRAME_Y + row * CELL_H + CELL_H / 2;

                if (locked) {
                    drawSymbol(ctx, finalGrid[row][col], cx, cy, Math.min(CELL_W, CELL_H));
                } else {
                    // Random blur symbol
                    const randomSym = Math.floor(Math.random() * SYMBOL_DISPLAY.length);
                    ctx.save();
                    ctx.globalAlpha = 0.4;
                    drawSymbol(ctx, randomSym, cx, cy, Math.min(CELL_W, CELL_H));
                    ctx.globalAlpha = 1.0;
                    // Motion blur overlay
                    ctx.fillStyle = 'rgba(10, 42, 20, 0.45)';
                    ctx.fillRect(
                        FRAME_X + col * CELL_W + 1,
                        FRAME_Y + row * CELL_H + 1,
                        CELL_W - 2,
                        CELL_H - 2
                    );
                    ctx.restore();
                }
            }
        }

        const isLastFrame = frame === totalFrames - 1;
        encoder.setDelay(isLastFrame ? 800 : 120);
        encoder.addFrame(ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data);
    }

    encoder.finish();
    const output = Buffer.concat(buffChunks);
    return new AttachmentBuilder(output, { name: 'slots-spin.gif' });
}

/**
 * Draw the paytable as a static PNG image.
 */
async function drawPaytable(jackpotDisplay, symbolTable) {
    const PT_W = 650;
    const PADDING = 20;
    const displayOrder = [...symbolTable].reverse();

    // Compute layout heights top-down
    const titleY = 38;
    const bannerTop = 50;
    const bannerH = 28;
    const symbolStartY = bannerTop + bannerH + 16;
    const symbolRowH = 32;
    const symbolSectionH = displayOrder.length * symbolRowH;
    const plTitleY = symbolStartY + symbolSectionH + 18;
    const plLabelY = plTitleY + 24;    // line name text
    const plGridY = plLabelY + 16;     // top of mini grids
    const miniCell = 16;
    const miniGridH = 3 * miniCell;    // 48px
    const rulesY = plGridY + miniGridH + 16;
    const PT_H = rulesY + 36 + PADDING;

    const canvas = createCanvas(PT_W, PT_H);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = FELT_DARK;
    ctx.fillRect(0, 0, PT_W, PT_H);
    roundRect(ctx, 8, 8, PT_W - 16, PT_H - 16, 12);
    ctx.fillStyle = FELT_COLOR;
    ctx.fill();
    ctx.strokeStyle = FRAME_GOLD;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Title
    ctx.font = 'bold 22px Arial';
    ctx.fillStyle = TEXT_GOLD;
    ctx.textAlign = 'center';
    ctx.fillText('SLOTS PAYTABLE', PT_W / 2, titleY);

    // Jackpot banner
    const bannerW = 340;
    const bannerX = (PT_W - bannerW) / 2;
    roundRect(ctx, bannerX, bannerTop, bannerW, bannerH, 6);
    ctx.fillStyle = '#2a0a00';
    ctx.fill();
    ctx.strokeStyle = FRAME_GOLD;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.font = 'bold 13px Arial';
    ctx.fillStyle = TEXT_GOLD;
    ctx.fillText(`PROGRESSIVE JACKPOT: ${jackpotDisplay}`, PT_W / 2, bannerTop + 18);

    // Symbol payouts (highest first)
    ctx.textAlign = 'left';
    for (let i = 0; i < displayOrder.length; i++) {
        const sym = displayOrder[i];
        const y = symbolStartY + i * symbolRowH + symbolRowH / 2;
        const symSize = 26;

        // Symbol icon
        drawSymbol(ctx, sym.index, 46, y, symSize);

        // Name
        ctx.font = 'bold 13px Arial';
        ctx.fillStyle = TEXT_WHITE;
        ctx.fillText(sym.name, 74, y + 4);

        // Payout description
        ctx.font = '12px Arial';
        if (sym.index === 7) {
            ctx.fillStyle = '#aaffaa';
            ctx.fillText(`3-match: JACKPOT  |  2-match: ${sym.partial}x`, 160, y + 4);
        } else if (sym.index === 8) {
            ctx.fillStyle = TEXT_GOLD;
            ctx.fillText('Substitutes for any symbol (except Scatter)', 160, y + 4);
        } else if (sym.index === 9) {
            ctx.fillStyle = '#ffff44';
            ctx.fillText('3+ anywhere = Bonus Free Spins (2x multiplier)', 160, y + 4);
        } else {
            ctx.fillStyle = '#aaffaa';
            ctx.fillText(`3-match: ${sym.multiplier}x  |  2-match: ${sym.partial}x`, 160, y + 4);
        }
    }

    // Separator line
    ctx.strokeStyle = FRAME_DARK_GOLD;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PADDING + 20, plTitleY - 8);
    ctx.lineTo(PT_W - PADDING - 20, plTitleY - 8);
    ctx.stroke();

    // Paylines section title
    ctx.font = 'bold 16px Arial';
    ctx.fillStyle = TEXT_GOLD;
    ctx.textAlign = 'center';
    ctx.fillText('PAYLINES', PT_W / 2, plTitleY + 6);

    const lineNames = ['Top Row', 'Middle Row', 'Bottom Row', 'Diagonal Down', 'Diagonal Up'];
    const miniGridW = 3 * miniCell;
    const colCount = 5;
    const colW = (PT_W - PADDING * 2) / colCount;

    for (let i = 0; i < colCount; i++) {
        const colCenterX = PADDING + colW * i + colW / 2;
        const gridLeft = colCenterX - miniGridW / 2;

        // Color dot + line label above grid
        ctx.font = '11px Arial';
        const label = `${i + 1}: ${lineNames[i]}`;
        const labelW = ctx.measureText(label).width;
        const dotX = colCenterX - labelW / 2 - 8;

        ctx.beginPath();
        ctx.arc(dotX, plLabelY + 1, 4, 0, Math.PI * 2);
        ctx.fillStyle = PAYLINE_COLORS[i];
        ctx.fill();

        ctx.fillStyle = TEXT_WHITE;
        ctx.textAlign = 'center';
        ctx.fillText(label, colCenterX, plLabelY + 4);

        // 3x3 mini grid
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                const mx = gridLeft + c * miniCell;
                const my = plGridY + r * miniCell;

                // Gray background for all cells
                ctx.fillStyle = '#2a2a2a';
                ctx.fillRect(mx, my, miniCell - 1, miniCell - 1);

                // Highlight payline cells with color
                const isOnLine = PAYLINES[i].some(([pr, pc]) => pr === r && pc === c);
                if (isOnLine) {
                    ctx.fillStyle = PAYLINE_COLORS[i];
                    ctx.globalAlpha = 0.8;
                    ctx.fillRect(mx, my, miniCell - 1, miniCell - 1);
                    ctx.globalAlpha = 1.0;
                }
            }
        }
    }

    // Separator line
    ctx.strokeStyle = FRAME_DARK_GOLD;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PADDING + 20, rulesY - 6);
    ctx.lineTo(PT_W - PADDING - 20, rulesY - 6);
    ctx.stroke();

    // Rules at bottom
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
