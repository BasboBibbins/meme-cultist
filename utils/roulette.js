const { createCanvas, loadImage } = require('canvas');
const { AttachmentBuilder } = require('discord.js');
const { getThemeColors } = require('../themes/resolver');

// Resolve classic roulette colors as the default fallback
const DEFAULT_COLORS = getThemeColors('classic', 'roulette');

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
    // Handle non-number bet types - return position in betting area
    if (typeof number === 'string') {
        const dozenW = GRID_W / 3;
        const evenW = GRID_W / 6;

        switch (number) {
            case 'red':    return { x: GRID_X + evenW * 2.5, y: EVEN_Y + EVEN_H / 2 };
            case 'black':  return { x: GRID_X + evenW * 3.5, y: EVEN_Y + EVEN_H / 2 };
            case 'even':   return { x: GRID_X + evenW * 1.5, y: EVEN_Y + EVEN_H / 2 };
            case 'odd':    return { x: GRID_X + evenW * 4.5, y: EVEN_Y + EVEN_H / 2 };
            case 'low':    return { x: GRID_X + evenW * 0.5, y: EVEN_Y + EVEN_H / 2 };
            case 'high':   return { x: GRID_X + evenW * 5.5, y: EVEN_Y + EVEN_H / 2 };
            case 'dozen1': return { x: GRID_X + dozenW * 0.5, y: DOZEN_Y + DOZEN_H / 2 };
            case 'dozen2': return { x: GRID_X + dozenW * 1.5, y: DOZEN_Y + DOZEN_H / 2 };
            case 'dozen3': return { x: GRID_X + dozenW * 2.5, y: DOZEN_Y + DOZEN_H / 2 };
            case 'column1': return { x: GRID_X + GRID_W + COL21_W * 0.5, y: TABLE_Y + CELL_H * 0.5 };
            case 'column2': return { x: GRID_X + GRID_W + COL21_W * 1.5, y: TABLE_Y + CELL_H * 1.5 };
            case 'column3': return { x: GRID_X + GRID_W + COL21_W * 2.5, y: TABLE_Y + CELL_H * 2.5 };
            default: return null;
        }
    }

    if (number === 0) {
        return { x: ZERO_X + ZERO_W / 2, y: TABLE_Y + GRID_H / 2 };
    }
    const index = ROULETTE_NUMBERS.indexOf(number);
    if (index === -1 || index >= 36) return null;

    const dataRow = Math.floor(index / 12);
    const col = index % 12;
    const displayRow = 2 - dataRow; // flip data-row to display-row

    return {
        x: GRID_X + col * CELL_W + CELL_W / 2,
        y: TABLE_Y + displayRow * CELL_H + CELL_H / 2
    };
}

function computeChipOffsets(count) {
    if (count <= 1) return [0];

    const BASE_SPACING = 26;
    const MAX_SPREAD = 32; // max distance from center in either direction

    const rawTotalWidth = (count - 1) * BASE_SPACING;
    const maxTotalWidth = MAX_SPREAD * 2;
    const scale = rawTotalWidth > maxTotalWidth ? maxTotalWidth / rawTotalWidth : 1;
    const spacing = BASE_SPACING * scale;

    const offsets = [];
    const centerIndex = (count - 1) / 2;
    for (let i = 0; i < count; i++) {
        offsets.push((i - centerIndex) * spacing);
    }
    return offsets;
}

async function drawChip(ctx, cx, cy, amount, avatarImg, chipColor) {
    const R        = 22;  // total chip radius
    const RIM_IN   = 15;  // inner edge of the decorative rim segments
    const RIM_OUT  = R - 1;
    const SEGMENTS = 8;
    const segAngle = (Math.PI * 2) / SEGMENTS;
    const gapAngle = segAngle * 0.35;
 
    ctx.save();
    ctx.shadowColor   = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur    = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = chipColor;
    ctx.fill();
    ctx.restore();
 
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = chipColor;
    ctx.fill();
 
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
 
    // white arc segments evenly distributed around the rim (classic chip inlay pattern)
    for (let i = 0; i < SEGMENTS; i++) {
        const start = i * segAngle + gapAngle / 2 - Math.PI / 2;
        const end   = start + segAngle - gapAngle;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(start) * RIM_IN, cy + Math.sin(start) * RIM_IN);
        ctx.arc(cx, cy, RIM_OUT, start, end);
        ctx.arc(cx, cy, RIM_IN,  end,   start, true);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.fill();
    }
 
    ctx.beginPath();
    ctx.arc(cx, cy, RIM_IN, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
 
    // clip avatar to the inner circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, RIM_IN - 1, 0, Math.PI * 2);
    ctx.clip();
    if (avatarImg) {
        ctx.drawImage(avatarImg, cx - RIM_IN + 1, cy - RIM_IN + 1, (RIM_IN - 1) * 2, (RIM_IN - 1) * 2);
    } else { // fallback if avatar fails to load
        ctx.fillStyle = chipColor;
        ctx.fillRect(cx - RIM_IN, cy - RIM_IN, RIM_IN * 2, RIM_IN * 2);
    }
    ctx.restore();
 
    ctx.fillStyle    = '#ffffff';
    ctx.font         = 'bold 11px Arial';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor  = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur   = 3;
    ctx.fillText(amount.toString(), cx, cy + R + 2);
    ctx.shadowBlur   = 0;
}

function drawWheel(ctx, highlightNumber = null, colors = DEFAULT_COLORS) {
    const cx = WHL_CX, cy = WHL_CY;
    const sliceAngle = (Math.PI * 2) / 37;
    const startAngle = -Math.PI / 2;

    // wooden outer ring
    const woodGrad = ctx.createRadialGradient(cx, cy, WHL_R_POCK, cx, cy, WHL_R_OUTER);
    woodGrad.addColorStop(0, colors.woodInner);
    woodGrad.addColorStop(0.5, colors.woodMid);
    woodGrad.addColorStop(1, colors.woodOuter);
    ctx.beginPath();
    ctx.arc(cx, cy, WHL_R_OUTER, 0, Math.PI * 2);
    ctx.fillStyle = woodGrad;
    ctx.fill();

    // gold rim
    ctx.beginPath();
    ctx.arc(cx, cy, WHL_R_OUTER, 0, Math.PI * 2);
    ctx.strokeStyle = colors.goldRim;
    ctx.lineWidth = 5;
    ctx.stroke();

    // number pockets
    for (let i = 0; i < 37; i++) {
        const num = WHEEL_ORDER[i];
        const angle = startAngle + i * sliceAngle;
        const isWinner = highlightNumber !== null && num === highlightNumber;
        const color = getRedBlack(num);

        ctx.fillStyle = isWinner ? colors.winnerHighlight
            : color === 'red' ? colors.pocketRed
            : color === 'black' ? colors.pocketBlack
            : colors.pocketGreen;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, WHL_R_POCK, angle, angle + sliceAngle);
        ctx.closePath();
        ctx.fill();

        // pocket divider
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(angle) * WHL_R_POCK, cy + Math.sin(angle) * WHL_R_POCK);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // number label (radially rotated)
        const labelR = (WHL_R_POCK + WHL_R_INNER) / 2;
        const midAngle = angle + sliceAngle / 2;
        const lx = cx + Math.cos(midAngle) * labelR;
        const ly = cy + Math.sin(midAngle) * labelR;

        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(midAngle + Math.PI / 2);
        ctx.fillStyle = isWinner ? colors.textBlack : colors.textWhite;
        ctx.font = 'bold 9px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(num.toString(), 0, 0);
        ctx.restore();
    }

    // inner ring and felt bowl
    ctx.beginPath();
    ctx.arc(cx, cy, WHL_R_INNER, 0, Math.PI * 2);
    ctx.strokeStyle = colors.goldRim;
    ctx.lineWidth = 3;
    ctx.stroke();

    const feltGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, WHL_R_INNER);
    feltGrad.addColorStop(0, colors.feltInner);
    feltGrad.addColorStop(0.7, colors.feltMid);
    feltGrad.addColorStop(1, colors.feltOuter);
    ctx.beginPath();
    ctx.arc(cx, cy, WHL_R_INNER, 0, Math.PI * 2);
    ctx.fillStyle = feltGrad;
    ctx.fill();

    // spokes
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * WHL_R_HUB, cy + Math.sin(a) * WHL_R_HUB);
        ctx.lineTo(cx + Math.cos(a) * (WHL_R_INNER - 6), cy + Math.sin(a) * (WHL_R_INNER - 6));
        ctx.strokeStyle = colors.spokeColor;
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // center hub
    const hubGrad = ctx.createRadialGradient(cx - 7, cy - 7, 2, cx, cy, WHL_R_HUB);
    hubGrad.addColorStop(0, colors.hubLight);
    hubGrad.addColorStop(0.5, colors.hubMid);
    hubGrad.addColorStop(1, colors.hubDark);
    ctx.beginPath();
    ctx.arc(cx, cy, WHL_R_HUB, 0, Math.PI * 2);
    ctx.fillStyle = hubGrad;
    ctx.fill();
    ctx.strokeStyle = colors.hubStroke;
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

    // shadow
    ctx.beginPath();
    ctx.arc(bx + 2, by + 3, 9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();

    // ball with 3D gradient
    const grad = ctx.createRadialGradient(bx - 3, by - 3, 1, bx, by, 9);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.4, '#e0e0e0');
    grad.addColorStop(1, '#999999');
    ctx.beginPath();
    ctx.arc(bx, by, 9, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
}

function drawBettingTable(ctx, highlightNumber = null, colors = DEFAULT_COLORS) {
    const tableBgW = ZERO_W + GRID_W + COL21_W + 12;
    const tableBgH = GRID_H + DOZEN_H + EVEN_H + 16;
    ctx.fillStyle = colors.tableGreen;
    roundRect(ctx, TABLE_BG_X, TABLE_Y - 4, tableBgW, tableBgH, 8);
    ctx.fill();

    // zero cell
    const zx = ZERO_X + PAD, zy = TABLE_Y + PAD;
    const zw = ZERO_W - PAD * 2, zh = GRID_H - PAD * 2;
    const zeroWin = highlightNumber === 0;

    ctx.fillStyle = zeroWin ? colors.winnerHighlight : colors.zeroGreen;
    roundRect(ctx, zx, zy, zw, zh, 10);
    ctx.fill();

    ctx.fillStyle = zeroWin ? colors.textBlack : colors.textWhite;
    ctx.font = 'bold 22px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('0', ZERO_X + ZERO_W / 2, TABLE_Y + GRID_H / 2);

    // number grid
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

        ctx.fillStyle = isWinner ? colors.winnerHighlight : getRedBlack(number) === 'red' ? colors.numberRed : colors.numberBlack;
        roundRect(ctx, x, y, w, h, 9);
        ctx.fill();

        ctx.fillStyle = isWinner ? colors.textBlack : colors.textWhite;
        ctx.font = 'bold 17px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(number.toString(), x + w / 2, y + h / 2);
    }

    // column bets (2:1)
    const c21X = GRID_X + GRID_W + 2;
    for (let row = 0; row < 3; row++) {
        const x = c21X + PAD;
        const y = TABLE_Y + row * CELL_H + PAD;
        const w = COL21_W - PAD * 2;
        const h = CELL_H - PAD * 2;

        ctx.fillStyle = colors.betArea;
        roundRect(ctx, x, y, w, h, 6);
        ctx.fill();
        ctx.strokeStyle = colors.betBorder;
        ctx.lineWidth = 1;
        roundRect(ctx, x, y, w, h, 6);
        ctx.stroke();

        // vertical text
        ctx.save();
        ctx.translate(c21X + COL21_W / 2, TABLE_Y + row * CELL_H + CELL_H / 2);
        ctx.rotate(Math.PI / 2);
        ctx.fillStyle = colors.textWhite;
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('2 to 1', 0, 0);
        ctx.restore();
    }

    // dozen bets
    const dozenW = GRID_W / 3;
    const dozenLabels = ['1st 12', '2nd 12', '3rd 12'];

    for (let d = 0; d < 3; d++) {
        const x = GRID_X + d * dozenW + PAD;
        const y = DOZEN_Y + PAD;
        const w = dozenW - PAD * 2;
        const h = DOZEN_H - PAD * 2;

        ctx.fillStyle = colors.betArea;
        roundRect(ctx, x, y, w, h, 5);
        ctx.fill();
        ctx.strokeStyle = colors.betBorder;
        ctx.lineWidth = 1;
        roundRect(ctx, x, y, w, h, 5);
        ctx.stroke();

        ctx.fillStyle = colors.textWhite;
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(dozenLabels[d], GRID_X + d * dozenW + dozenW / 2, DOZEN_Y + DOZEN_H / 2);
    }

    // even-money bets
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

        ctx.fillStyle = bg === 'red' ? colors.numberRed : bg === 'blk' ? colors.numberBlack : colors.betArea;
        roundRect(ctx, x, y, w, h, 5);
        ctx.fill();
        ctx.strokeStyle = colors.betBorder;
        ctx.lineWidth = 1;
        roundRect(ctx, x, y, w, h, 5);
        ctx.stroke();

        ctx.fillStyle = colors.textWhite;
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, GRID_X + e * evenW + evenW / 2, EVEN_Y + EVEN_H / 2);
    }
}

function drawTitle(ctx, colors = DEFAULT_COLORS) {
    ctx.fillStyle = colors.gold;
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`ROULETTE`, CANVAS_W / 2, 46);
}

async function drawRouletteTable(bets = [], userAvatars = {}, userColors = {}, colors = DEFAULT_COLORS) {
    const canvas = createCanvas(CANVAS_W, CANVAS_H);
    const ctx = canvas.getContext('2d');

    if (colors.background) {
        try {
            const bgImg = await loadImage(colors.background);
            ctx.drawImage(bgImg, 0, 0, CANVAS_W, CANVAS_H);
        } catch (err) {
            ctx.fillStyle = colors.feltColor;
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        }
    } else {
        ctx.fillStyle = colors.feltColor;
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    drawWheel(ctx, null, colors);
    drawBettingTable(ctx, null, colors);
    drawTitle(ctx, colors);

    const avatarImages = {};
    const uniqueUserIds = [...new Set(bets.map(b => b.userId).filter(Boolean))];
    await Promise.all(uniqueUserIds.map(async userId => {
        const url = userAvatars[userId];
        if (url) {
            try { avatarImages[userId] = await loadImage(url); } catch { /* fall back to solid */ }
        }
    }));

    // Group bets by board position so chips can sit side-by-side
    const betsByPosition = {};
    for (const bet of bets) {
        const key = String(bet.number);
        if (!betsByPosition[key]) betsByPosition[key] = [];
        betsByPosition[key].push(bet);
    }

    for (const group of Object.values(betsByPosition)) {
        const basePos = getNumberPosition(group[0].number);
        if (!basePos) continue;

        const offsets = computeChipOffsets(group.length);
        group.forEach((bet, index) => {
            const avatarImg = avatarImages[bet.userId] ?? null;
            const chipColor = userColors[bet.userId] ?? '#888888';
            drawChip(ctx, basePos.x + offsets[index], basePos.y, bet.amount, avatarImg, chipColor);
        });
    }

    const buffer = canvas.toBuffer('image/png');
    return new AttachmentBuilder(buffer).setName('roulette.png');
}

async function drawBall(canvas, number) {
    drawBallOnWheel(canvas.getContext('2d'), number);
    return canvas;
}

async function drawResult(number, totalWinnings = 0, isFinal = false, bets = [], userAvatars = {}, userColors = {}, colors = DEFAULT_COLORS) {
    const canvas = createCanvas(CANVAS_W, CANVAS_H);
    const ctx = canvas.getContext('2d');

    if (colors.background) {
        try {
            const bgImg = await loadImage(colors.background);
            ctx.drawImage(bgImg, 0, 0, CANVAS_W, CANVAS_H);
        } catch (err) {
            ctx.fillStyle = colors.feltColor;
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        }
    } else {
        ctx.fillStyle = colors.feltColor;
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    drawWheel(ctx, number, colors);
    drawBallOnWheel(ctx, number);
    drawBettingTable(ctx, number, colors);
    drawTitle(ctx, colors);

    // Load user avatars and draw chips
    if (bets.length > 0) {
        const avatarImages = {};
        const uniqueUserIds = [...new Set(bets.map(b => b.userId).filter(Boolean))];
        await Promise.all(uniqueUserIds.map(async userId => {
            const url = userAvatars[userId];
            if (url) {
                try { avatarImages[userId] = await loadImage(url); } catch { /* fall back to solid */ }
            }
        }));

        // Group bets by board position so chips can sit side-by-side
        const betsByPosition = {};
        for (const bet of bets) {
            const key = String(bet.number);
            if (!betsByPosition[key]) betsByPosition[key] = [];
            betsByPosition[key].push(bet);
        }

        for (const group of Object.values(betsByPosition)) {
            const basePos = getNumberPosition(group[0].number);
            if (!basePos) continue;

            const offsets = computeChipOffsets(group.length);
            group.forEach((bet, index) => {
                const avatarImg = avatarImages[bet.userId] ?? null;
                const chipColor = userColors[bet.userId] ?? '#888888';
                drawChip(ctx, basePos.x + offsets[index], basePos.y, bet.amount, avatarImg, chipColor);
            });
        }
    }

    // result overlay
    const resultColor = getRedBlack(number);
    const boxBg = number === 0 ? colors.pocketGreen : resultColor === 'red' ? colors.numberRed : colors.numberBlack;

    const bw = 180, bh = 120;
    const bx = GRID_X + GRID_W / 2 - bw / 2;
    const by = TABLE_Y + GRID_H / 2 - bh / 2;

    // bg overlay on final result
    if (isFinal) {
        ctx.fillStyle = colors.resultOverlay;
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        // shadow
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        roundRect(ctx, bx - 4, by - 4, bw + 8, bh + 8, 14);
        ctx.fill();

        // box
        ctx.fillStyle = boxBg;
        roundRect(ctx, bx, by, bw, bh, 11);
        ctx.fill();
        ctx.strokeStyle = colors.resultBorder;
        ctx.lineWidth = 3;
        roundRect(ctx, bx, by, bw, bh, 11);
        ctx.stroke();

        // winning number
        ctx.fillStyle = colors.textWhite;
        ctx.font = 'bold 56px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(number.toString(), bx + bw / 2, by + (totalWinnings > 0 ? bh * 0.58 : bh / 2));

        // winning number text
        ctx.fillStyle = colors.gold;
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Winning Number:', bx + bw / 2, by + bh * 0.15);
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