const { createCanvas } = require('canvas');
const { AttachmentBuilder } = require('discord.js');

// Physical pocket order around the wheel
const WHEEL_ORDER = [
    0, 32, 15, 19,  4, 21,  2, 25, 17, 34,  6, 27,
   13, 36, 11, 30,  8, 23, 10,  5, 24, 16, 33,  1,
   20, 14, 31,  9, 22, 18, 29,  7, 28, 12, 35,  3, 26
];

// Grid order (display rows are reversed from data rows)
const ROULETTE_NUMBERS = [
     1,  4,  7, 10, 13, 16, 19, 22, 25, 28, 31, 34,
     2,  5,  8, 11, 14, 17, 20, 23, 26, 29, 32, 35,
     3,  6,  9, 12, 15, 18, 21, 24, 27, 30, 33, 36,
     0
];

const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

function getRedBlack(number) {
    if (number === 0) return 'green';
    return RED_NUMBERS.includes(number) ? 'red' : 'black';
}

// Canvas dimensions
const CANVAS_W = 1100;
const CANVAS_H = 400;

// Wheel positioning
const WHL_CX = 183, WHL_CY = 208;
const WHL_R_OUTER = 155, WHL_R_POCK = 128, WHL_R_INNER = 88, WHL_R_HUB = 24;

// Betting table layout
const TABLE_BG_X = 366, ZERO_X = 372, ZERO_W = 48;
const GRID_X = ZERO_X + ZERO_W, CELL_W = 50, CELL_H = 54;
const GRID_COLS = 12, GRID_ROWS = 3;
const GRID_W = CELL_W * GRID_COLS, GRID_H = CELL_H * GRID_ROWS;
const COL21_W = 56, TABLE_Y = 88, PAD = 3;
const DOZEN_H = 44, DOZEN_Y = TABLE_Y + GRID_H + 2;
const EVEN_H = 44, EVEN_Y = DOZEN_Y + DOZEN_H + 2;

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

function getNumberPosition(number) {
    if (number === 0) {
        return { x: ZERO_X + ZERO_W / 2, y: TABLE_Y + GRID_H / 2 };
    }
    const index = ROULETTE_NUMBERS.indexOf(number);
    if (index === -1 || index >= 36) return null;

    const dataRow = Math.floor(index / 12);
    const col = index % 12;
    const displayRow = 2 - dataRow; // Flip data-row to display-row

    return {
        x: GRID_X + col * CELL_W + CELL_W / 2,
        y: TABLE_Y + displayRow * CELL_H + CELL_H / 2
    };
}

function drawWheel(ctx, highlightNumber = null) {
    const cx = WHL_CX, cy = WHL_CY;
    const sliceAngle = (Math.PI * 2) / 37;
    const startAngle = -Math.PI / 2;

    // Wooden outer ring
    const woodGrad = ctx.createRadialGradient(cx, cy, WHL_R_POCK, cx, cy, WHL_R_OUTER);
    woodGrad.addColorStop(0, '#6b3a0f');
    woodGrad.addColorStop(0.5, '#4a2808');
    woodGrad.addColorStop(1, '#2e1a05');
    ctx.beginPath();
    ctx.arc(cx, cy, WHL_R_OUTER, 0, Math.PI * 2);
    ctx.fillStyle = woodGrad;
    ctx.fill();

    // Gold rim
    ctx.beginPath();
    ctx.arc(cx, cy, WHL_R_OUTER, 0, Math.PI * 2);
    ctx.strokeStyle = '#c8a830';
    ctx.lineWidth = 5;
    ctx.stroke();

    // Number pockets
    for (let i = 0; i < 37; i++) {
        const num = WHEEL_ORDER[i];
        const angle = startAngle + i * sliceAngle;
        const isWinner = highlightNumber !== null && num === highlightNumber;
        const color = getRedBlack(num);

        ctx.fillStyle = isWinner ? '#ffd700'
            : color === 'red' ? '#c0392b'
            : color === 'black' ? '#1a1a1a'
            : '#1a8a3f';

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, WHL_R_POCK, angle, angle + sliceAngle);
        ctx.closePath();
        ctx.fill();

        // Pocket divider
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(angle) * WHL_R_POCK, cy + Math.sin(angle) * WHL_R_POCK);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Number label (radially rotated)
        const labelR = (WHL_R_POCK + WHL_R_INNER) / 2;
        const midAngle = angle + sliceAngle / 2;
        const lx = cx + Math.cos(midAngle) * labelR;
        const ly = cy + Math.sin(midAngle) * labelR;

        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(midAngle + Math.PI / 2);
        ctx.fillStyle = isWinner ? '#000000' : '#ffffff';
        ctx.font = 'bold 9px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(num.toString(), 0, 0);
        ctx.restore();
    }

    // Inner ring and felt bowl
    ctx.beginPath();
    ctx.arc(cx, cy, WHL_R_INNER, 0, Math.PI * 2);
    ctx.strokeStyle = '#c8a830';
    ctx.lineWidth = 3;
    ctx.stroke();

    const feltGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, WHL_R_INNER);
    feltGrad.addColorStop(0, '#237a3d');
    feltGrad.addColorStop(0.7, '#1a6b35');
    feltGrad.addColorStop(1, '#145228');
    ctx.beginPath();
    ctx.arc(cx, cy, WHL_R_INNER, 0, Math.PI * 2);
    ctx.fillStyle = feltGrad;
    ctx.fill();

    // Spokes
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * WHL_R_HUB, cy + Math.sin(a) * WHL_R_HUB);
        ctx.lineTo(cx + Math.cos(a) * (WHL_R_INNER - 6), cy + Math.sin(a) * (WHL_R_INNER - 6));
        ctx.strokeStyle = '#c8a830';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // Centre hub
    const hubGrad = ctx.createRadialGradient(cx - 7, cy - 7, 2, cx, cy, WHL_R_HUB);
    hubGrad.addColorStop(0, '#f5e070');
    hubGrad.addColorStop(0.5, '#c8a830');
    hubGrad.addColorStop(1, '#8a6020');
    ctx.beginPath();
    ctx.arc(cx, cy, WHL_R_HUB, 0, Math.PI * 2);
    ctx.fillStyle = hubGrad;
    ctx.fill();
    ctx.strokeStyle = '#f0d060';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function drawBallOnWheel(ctx, number) {
    const cx = WHL_CX, cy = WHL_CY;
    const sliceAngle = (Math.PI * 2) / 37;
    const startAngle = -Math.PI / 2;

    const wheelIndex = WHEEL_ORDER.indexOf(number);
    const midAngle = startAngle + (wheelIndex + 0.5) * sliceAngle;
    const ballDist = WHL_R_POCK + (WHL_R_OUTER - WHL_R_POCK) * 0.45;

    const bx = cx + Math.cos(midAngle) * ballDist;
    const by = cy + Math.sin(midAngle) * ballDist;

    // Shadow
    ctx.beginPath();
    ctx.arc(bx + 2, by + 3, 9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();

    // Ball with 3D gradient
    const grad = ctx.createRadialGradient(bx - 3, by - 3, 1, bx, by, 9);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.4, '#e0e0e0');
    grad.addColorStop(1, '#999999');
    ctx.beginPath();
    ctx.arc(bx, by, 9, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
}

function drawBettingTable(ctx, highlightNumber = null) {
    const tableBgW = ZERO_W + GRID_W + COL21_W + 12;
    const tableBgH = GRID_H + DOZEN_H + EVEN_H + 16;
    ctx.fillStyle = '#1a6b35';
    roundRect(ctx, TABLE_BG_X, TABLE_Y - 4, tableBgW, tableBgH, 8);
    ctx.fill();

    // Zero cell
    const zx = ZERO_X + PAD, zy = TABLE_Y + PAD;
    const zw = ZERO_W - PAD * 2, zh = GRID_H - PAD * 2;
    const zeroWin = highlightNumber === 0;

    ctx.fillStyle = zeroWin ? '#ffd700' : '#27ae60';
    roundRect(ctx, zx, zy, zw, zh, 10);
    ctx.fill();

    ctx.fillStyle = zeroWin ? '#000000' : '#ffffff';
    ctx.font = 'bold 22px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('0', ZERO_X + ZERO_W / 2, TABLE_Y + GRID_H / 2);

    // Number grid
    for (let i = 0; i < 36; i++) {
        const number = ROULETTE_NUMBERS[i];
        const dataRow = Math.floor(i / 12);
        const col = i % 12;
        const displayRow = 2 - dataRow;

        const x = GRID_X + col * CELL_W + PAD;
        const y = TABLE_Y + displayRow * CELL_H + PAD;
        const w = CELL_W - PAD * 2;
        const h = CELL_H - PAD * 2;

        const isWinner = highlightNumber === number;

        ctx.fillStyle = isWinner ? '#ffd700' : getRedBlack(number) === 'red' ? '#c0392b' : '#1a1a1a';
        roundRect(ctx, x, y, w, h, 9);
        ctx.fill();

        ctx.fillStyle = isWinner ? '#000000' : '#ffffff';
        ctx.font = 'bold 17px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(number.toString(), x + w / 2, y + h / 2);
    }

    // Column bets (2:1)
    const c21X = GRID_X + GRID_W + 2;
    for (let row = 0; row < 3; row++) {
        const x = c21X + PAD;
        const y = TABLE_Y + row * CELL_H + PAD;
        const w = COL21_W - PAD * 2;
        const h = CELL_H - PAD * 2;

        ctx.fillStyle = '#1e7a3d';
        roundRect(ctx, x, y, w, h, 6);
        ctx.fill();
        ctx.strokeStyle = '#88aa88';
        ctx.lineWidth = 1;
        roundRect(ctx, x, y, w, h, 6);
        ctx.stroke();

        // Vertical text
        ctx.save();
        ctx.translate(c21X + COL21_W / 2, TABLE_Y + row * CELL_H + CELL_H / 2);
        ctx.rotate(Math.PI / 2);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('2 to 1', 0, 0);
        ctx.restore();
    }

    // Dozen bets
    const dozenW = GRID_W / 3;
    const dozenLabels = ['1st 12', '2nd 12', '3rd 12'];

    for (let d = 0; d < 3; d++) {
        const x = GRID_X + d * dozenW + PAD;
        const y = DOZEN_Y + PAD;
        const w = dozenW - PAD * 2;
        const h = DOZEN_H - PAD * 2;

        ctx.fillStyle = '#1e7a3d';
        roundRect(ctx, x, y, w, h, 5);
        ctx.fill();
        ctx.strokeStyle = '#88aa88';
        ctx.lineWidth = 1;
        roundRect(ctx, x, y, w, h, 5);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(dozenLabels[d], GRID_X + d * dozenW + dozenW / 2, DOZEN_Y + DOZEN_H / 2);
    }

    // Even-money bets
    const evenW = GRID_W / 6;
    const evenAreas = [
        { label: '1-18', bg: null },
        { label: 'Even', bg: null },
        { label: 'Red', bg: 'red' },
        { label: 'Black', bg: 'blk' },
        { label: 'Odd', bg: null },
        { label: '19-36', bg: null },
    ];

    for (let e = 0; e < 6; e++) {
        const { label, bg } = evenAreas[e];
        const x = GRID_X + e * evenW + PAD;
        const y = EVEN_Y + PAD;
        const w = evenW - PAD * 2;
        const h = EVEN_H - PAD * 2;

        ctx.fillStyle = bg === 'red' ? '#c0392b' : bg === 'blk' ? '#1a1a1a' : '#1e7a3d';
        roundRect(ctx, x, y, w, h, 5);
        ctx.fill();
        ctx.strokeStyle = '#88aa88';
        ctx.lineWidth = 1;
        roundRect(ctx, x, y, w, h, 5);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, GRID_X + e * evenW + evenW / 2, EVEN_Y + EVEN_H / 2);
    }
}

function drawTitle(ctx) {
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ROULETTE', CANVAS_W / 2, 46);
}

async function drawRouletteTable(bets = []) {
    const canvas = createCanvas(CANVAS_W, CANVAS_H);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0f4c25';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawWheel(ctx);
    drawBettingTable(ctx);
    drawTitle(ctx);

    // Bet chips
    for (const bet of bets) {
        const pos = getNumberPosition(bet.number);
        if (!pos) continue;

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 14, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd700';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#000000';
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(bet.amount.toString(), pos.x, pos.y);
    }

    const buffer = canvas.toBuffer('image/png');
    return new AttachmentBuilder(buffer).setName('roulette.png');
}

async function drawBall(canvas, number) {
    drawBallOnWheel(canvas.getContext('2d'), number);
    return canvas;
}

async function drawResult(number, totalWinnings = 0, isFinal = false) {
    const canvas = createCanvas(CANVAS_W, CANVAS_H);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0f4c25';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawWheel(ctx, number);
    drawBallOnWheel(ctx, number);
    drawBettingTable(ctx, number);
    drawTitle(ctx);

    // Result overlay
    const resultColor = getRedBlack(number);
    const boxBg = number === 0 ? '#1a8a3f' : resultColor === 'red' ? '#c0392b' : '#1a1a1a';

    const bw = 180, bh = 120;
    const bx = GRID_X + GRID_W / 2 - bw / 2;
    const by = TABLE_Y + GRID_H / 2 - bh / 2;

    // Bg Overlay
    if (isFinal) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    roundRect(ctx, bx - 4, by - 4, bw + 8, bh + 8, 14);
    ctx.fill();

    // Box
    ctx.fillStyle = boxBg;
    roundRect(ctx, bx, by, bw, bh, 11);
    ctx.fill();
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 3;
    roundRect(ctx, bx, by, bw, bh, 11);
    ctx.stroke();

    // Winning number
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 56px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(number.toString(), bx + bw / 2, by + (totalWinnings > 0 ? bh * 0.42 : bh / 2));

    // Win amount
    if (totalWinnings > 0) {
        ctx.fillStyle = '#00ee44';
        ctx.font = 'bold 22px Arial';
        ctx.textBaseline = 'middle';
        ctx.fillText(`+${totalWinnings}`, bx + bw / 2, by + bh * 0.80);
    } else {
        ctx.fillStyle = '#ee4444';
        ctx.font = 'bold 22px Arial';
        ctx.textBaseline = 'middle';
        ctx.fillText(`-${betAmount}`, bx + bw / 2, by + bh * 0.80);
    }

    const buffer = canvas.toBuffer('image/png');
    return new AttachmentBuilder(buffer).setName('roulette.png');
}

function spinWheel() {
    return Math.floor(Math.random() * 37);
}

function calculateWinnings(betType, betNumber, betAmount, winningNumber) {
    let won = false;
    let multiplier = 0;

    switch (betType) {
        case 'straight':
            won = winningNumber === betNumber;
            multiplier = 35;
            break;
        case 'red':
            won = winningNumber !== 0 && getRedBlack(winningNumber) === 'red';
            multiplier = 2;
            break;
        case 'black':
            won = winningNumber !== 0 && getRedBlack(winningNumber) === 'black';
            multiplier = 2;
            break;
        case 'even':
            won = winningNumber !== 0 && winningNumber % 2 === 0;
            multiplier = 2;
            break;
        case 'odd':
            won = winningNumber !== 0 && winningNumber % 2 !== 0;
            multiplier = 2;
            break;
        case 'low':
            won = winningNumber >= 1 && winningNumber <= 18;
            multiplier = 2;
            break;
        case 'high':
            won = winningNumber >= 19 && winningNumber <= 36;
            multiplier = 2;
            break;
        case 'dozen1':
            won = winningNumber >= 1 && winningNumber <= 12;
            multiplier = 3;
            break;
        case 'dozen2':
            won = winningNumber >= 13 && winningNumber <= 24;
            multiplier = 3;
            break;
        case 'dozen3':
            won = winningNumber >= 25 && winningNumber <= 36;
            multiplier = 3;
            break;
        case 'column1':
            won = winningNumber > 0 && (winningNumber - 1) % 3 === 0;
            multiplier = 3;
            break;
        case 'column2':
            won = winningNumber > 0 && (winningNumber - 2) % 3 === 0;
            multiplier = 3;
            break;
        case 'column3':
            won = winningNumber > 0 && winningNumber % 3 === 0;
            multiplier = 3;
            break;
    }

    return won ? betAmount * multiplier : 0;
}

module.exports = {
    drawRouletteTable,
    drawBall,
    drawResult,
    spinWheel,
    calculateWinnings,
    getRedBlack,
    getNumberPosition,
    ROULETTE_NUMBERS,
    RED_NUMBERS
};