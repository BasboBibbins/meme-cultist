const { createCanvas, loadImage } = require("canvas");
const { AttachmentBuilder } = require("discord.js");
const { getThemeColors } = require("../themes/resolver");
const { encodeGIF } = require("./gifUtil");
const { BET_DEFINITIONS } = require("./craps");
const logger = require("./logger");

const DEFAULT_COLORS = getThemeColors("classic", "craps");

const BG_CACHE = new Map();

const CANVAS_W = 1100;
const CANVAS_H = 500;

// Zone layout — each bet on the table maps to a rectangle here. The renderer
// just iterates ZONES and draws labels + chips; chip positions come from these
// same rects so the visual and logical mapping can't drift.
const ZONES = {
    // Place row (top strip, 6 across full width)
    place_4:   { x: 30,  y: 65,  w: 170, h: 85, label: "PLACE 4",  payoutText: "9:5", colorKey: "placeColor" },
    place_5:   { x: 205, y: 65,  w: 170, h: 85, label: "PLACE 5",  payoutText: "7:5", colorKey: "placeColor" },
    place_6:   { x: 380, y: 65,  w: 170, h: 85, label: "PLACE 6",  payoutText: "7:6", colorKey: "placeColor" },
    place_8:   { x: 555, y: 65,  w: 170, h: 85, label: "PLACE 8",  payoutText: "7:6", colorKey: "placeColor" },
    place_9:   { x: 730, y: 65,  w: 170, h: 85, label: "PLACE 9",  payoutText: "7:5", colorKey: "placeColor" },
    place_10:  { x: 905, y: 65,  w: 165, h: 85, label: "PLACE 10", payoutText: "9:5", colorKey: "placeColor" },

    // Center block
    come:      { x: 30,  y: 160, w: 450, h: 100, label: "COME", payoutText: "1:1", colorKey: "comeColor" },
    dontCome:  { x: 30,  y: 270, w: 450, h: 50,  label: "DON'T COME", payoutText: "1:1", colorKey: "comeColor" },
    field:     { x: 30,  y: 330, w: 690, h: 60,  label: "FIELD", payoutText: "2/3/4/9/10/11 (1:1) · 2 (2:1) · 12 (3:1)", colorKey: "fieldColor" },

    // Hard ways 2x2
    hard_4:    { x: 490, y: 160, w: 110, h: 50, label: "HARD 4",  payoutText: "7:1", colorKey: "hardWaysColor" },
    hard_6:    { x: 610, y: 160, w: 110, h: 50, label: "HARD 6",  payoutText: "9:1", colorKey: "hardWaysColor" },
    hard_8:    { x: 490, y: 215, w: 110, h: 50, label: "HARD 8",  payoutText: "9:1", colorKey: "hardWaysColor" },
    hard_10:   { x: 610, y: 215, w: 110, h: 50, label: "HARD 10", payoutText: "7:1", colorKey: "hardWaysColor" },

    // Big bets (just below hard ways)
    big6:      { x: 490, y: 270, w: 110, h: 50, label: "BIG 6", payoutText: "1:1", colorKey: "bigSixEightColor" },
    big8:      { x: 610, y: 270, w: 110, h: 50, label: "BIG 8", payoutText: "1:1", colorKey: "bigSixEightColor" },

    // Props column (right side, stacked)
    any7:      { x: 730, y: 160, w: 340, h: 40, label: "ANY 7",      payoutText: "4:1",  colorKey: "propsColor" },
    anyCraps:  { x: 730, y: 205, w: 340, h: 40, label: "ANY CRAPS",  payoutText: "7:1",  colorKey: "propsColor" },
    yo:        { x: 730, y: 250, w: 340, h: 40, label: "YO (11)",    payoutText: "15:1", colorKey: "propsColor" },
    two:       { x: 730, y: 295, w: 165, h: 40, label: "ACES (2)",   payoutText: "30:1", colorKey: "propsColor" },
    twelve:    { x: 905, y: 295, w: 165, h: 40, label: "BOXCARS (12)", payoutText: "30:1", colorKey: "propsColor" },
    three:     { x: 730, y: 340, w: 165, h: 40, label: "ACE-DEUCE (3)", payoutText: "15:1", colorKey: "propsColor" },
    ce:        { x: 905, y: 340, w: 80,  h: 40, label: "C & E",      payoutText: "",     colorKey: "propsColor" },
    horn:      { x: 990, y: 340, w: 80,  h: 40, label: "HORN",       payoutText: "",     colorKey: "propsColor" },

    // Line bets along bottom
    dontPass:  { x: 30, y: 395, w: 1040, h: 30, label: "DON'T PASS BAR", payoutText: "1:1", colorKey: "dontPassColor" },
    pass:      { x: 30, y: 425, w: 1040, h: 50, label: "PASS LINE",      payoutText: "1:1", colorKey: "passLineColor" },
};

// Pip positions (relative to die face, normalized 0..1).
const PIP_POSITIONS = {
    1: [[0.5, 0.5]],
    2: [[0.25, 0.25], [0.75, 0.75]],
    3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
    4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
    5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
    6: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.5], [0.75, 0.5], [0.25, 0.75], [0.75, 0.75]],
};

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

function drawDieFace(ctx, x, y, size, value, colors, rotationRad = 0) {
    ctx.save();
    ctx.translate(x + size / 2, y + size / 2);
    if (rotationRad) ctx.rotate(rotationRad);
    ctx.translate(-size / 2, -size / 2);

    ctx.save();
    ctx.shadowColor = colors.diceShadow || "rgba(0,0,0,0.4)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = colors.diceFace || "#ffffff";
    roundRect(ctx, 0, 0, size, size, size * 0.18);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, 0, 0, size, size, size * 0.18);
    ctx.stroke();

    const pipR = size * 0.085;
    const safeValue = Math.max(1, Math.min(6, value | 0));
    ctx.fillStyle = colors.diceDots || "#000000";
    for (const [nx, ny] of PIP_POSITIONS[safeValue]) {
        ctx.beginPath();
        ctx.arc(nx * size, ny * size, pipR, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

function drawChipStack(ctx, cx, cy, amount, avatarImg, chipColor) {
    const R = 22;
    const RIM_IN = 15;
    const SEGMENTS = 8;
    const segAngle = (Math.PI * 2) / SEGMENTS;
    const gapAngle = segAngle * 0.35;

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 6;
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
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();

    for (let i = 0; i < SEGMENTS; i++) {
        const start = i * segAngle + gapAngle / 2 - Math.PI / 2;
        const end = start + segAngle - gapAngle;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(start) * RIM_IN, cy + Math.sin(start) * RIM_IN);
        ctx.arc(cx, cy, R - 1, start, end);
        ctx.arc(cx, cy, RIM_IN, end, start, true);
        ctx.closePath();
        ctx.fillStyle = "rgba(255,255,255,0.88)";
        ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, RIM_IN, 0, Math.PI * 2);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, RIM_IN - 1, 0, Math.PI * 2);
    ctx.clip();
    if (avatarImg) {
        ctx.drawImage(avatarImg, cx - RIM_IN + 1, cy - RIM_IN + 1, (RIM_IN - 1) * 2, (RIM_IN - 1) * 2);
    } else {
        ctx.fillStyle = chipColor;
        ctx.fillRect(cx - RIM_IN, cy - RIM_IN, RIM_IN * 2, RIM_IN * 2);
    }
    ctx.restore();

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 11px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 3;
    ctx.fillText(amount.toLocaleString("en-US"), cx, cy + R + 2);
    ctx.shadowBlur = 0;
}

function drawZone(ctx, zone, colors, opts = {}) {
    const fill = opts.highlight ? colors.winnerHighlight : (colors[zone.colorKey] || colors.tableGreen || "#1a6b35");
    const border = colors.layoutLine || colors.gold || "#ffd700";
    const labelColor = colors.layoutLabel || colors.textWhite || "#ffffff";

    ctx.fillStyle = fill;
    roundRect(ctx, zone.x, zone.y, zone.w, zone.h, 8);
    ctx.fill();

    ctx.strokeStyle = border;
    ctx.lineWidth = opts.highlight ? 3 : 1.5;
    roundRect(ctx, zone.x, zone.y, zone.w, zone.h, 8);
    ctx.stroke();

    // Disabled overlay for zones the user can't bet on right now.
    if (opts.disabled) {
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        roundRect(ctx, zone.x, zone.y, zone.w, zone.h, 8);
        ctx.fill();
    }

    ctx.fillStyle = labelColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const cx = zone.x + zone.w / 2;
    const labelFont = Math.min(18, Math.max(11, zone.h * 0.25));
    ctx.font = `bold ${Math.round(labelFont)}px Arial`;
    const labelY = zone.payoutText ? zone.y + zone.h * 0.38 : zone.y + zone.h / 2;
    ctx.fillText(zone.label, cx, labelY);

    if (zone.payoutText) {
        ctx.font = `${Math.round(labelFont * 0.7)}px Arial`;
        ctx.fillStyle = colors.gold || "#ffd700";
        ctx.fillText(zone.payoutText, cx, zone.y + zone.h * 0.72);
    }
}

function drawPuck(ctx, x, y, point, colors) {
    const r = 30;
    const on = point != null;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = on ? (colors.puckOn || "#ffffff") : (colors.puckOff || "#1a1a1a");
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = colors.gold || "#ffd700";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = on ? (colors.puckText || "#000000") : (colors.textWhite || "#ffffff");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (on) {
        ctx.font = "bold 10px Arial";
        ctx.fillText("ON", x, y - 9);
        ctx.font = "bold 22px Arial";
        ctx.fillText(String(point), x, y + 6);
    } else {
        ctx.font = "bold 14px Arial";
        ctx.fillText("OFF", x, y);
    }
}

function drawHeader(ctx, state, colors) {
    ctx.fillStyle = colors.gold || "#ffd700";
    ctx.font = "bold 32px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("CRAPS", CANVAS_W / 2, 32);

    drawPuck(ctx, 70, 32, state.point, colors);

    if (state.lastRoll) {
        const { d1, d2 } = state.lastRoll;
        drawDieFace(ctx, 960, 4, 50, d1, colors);
        drawDieFace(ctx, 1020, 4, 50, d2, colors);
    }
}

async function loadBackground(ctx, colors) {
    if (colors.background) {
        try {
            let bgImg = BG_CACHE.get(colors.background);
            if (!bgImg) {
                bgImg = await loadImage(colors.background);
                BG_CACHE.set(colors.background, bgImg);
            }
            const scale = Math.max(CANVAS_W / bgImg.width, CANVAS_H / bgImg.height);
            const drawW = bgImg.width * scale;
            const drawH = bgImg.height * scale;
            const dx = (CANVAS_W - drawW) / 2;
            const dy = (CANVAS_H - drawH) / 2;
            ctx.drawImage(bgImg, dx, dy, drawW, drawH);
            // Felt tint over the bg keeps the table readable when the bg is busy.
            ctx.fillStyle = colors.feltColor || "rgba(15, 76, 37, 0.6)";
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
            return;
        } catch (err) {
            logger.warn("Failed to load craps background image, using fallback color", { error: err });
        }
    }
    // Radial felt gradient for the no-image case.
    const grad = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H / 2, 50, CANVAS_W / 2, CANVAS_H / 2, CANVAS_W * 0.7);
    grad.addColorStop(0, colors.feltInner || colors.feltColor || "#237a3d");
    grad.addColorStop(0.7, colors.feltMid || colors.feltColor || "#1a6b35");
    grad.addColorStop(1, colors.feltOuter || colors.feltDark || "#145228");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

// Aggregate per-zone chip-render data: { zoneKey: { amount, label? } }
function aggregateBets(bets) {
    const out = {};
    for (const bet of bets) {
        const def = BET_DEFINITIONS[bet.betKey];
        if (!def) continue;
        // Come/Don't Come bets that have traveled live on a Place-equivalent zone.
        let zoneKey = bet.betKey;
        if ((bet.betKey === "come" || bet.betKey === "dontCome") && bet.cameToPoint != null) {
            zoneKey = `place_${bet.cameToPoint}`;
        } else if (bet.betKey === "pass_odds") {
            // Pass odds visually stack on the Pass Line.
            zoneKey = "pass";
        } else if (bet.betKey === "dontPass_odds") {
            zoneKey = "dontPass";
        } else if (/^come_odds_/.test(bet.betKey)) {
            zoneKey = `place_${bet.betKey.replace('come_odds_', '')}`;
        } else if (/^dontCome_odds_/.test(bet.betKey)) {
            zoneKey = `place_${bet.betKey.replace('dontCome_odds_', '')}`;
        }
        if (!out[zoneKey]) out[zoneKey] = { amount: 0, count: 0 };
        out[zoneKey].amount += bet.amount;
        out[zoneKey].count += 1;
    }
    return out;
}

// Determine which zones should be disabled given current phase/point.
function disabledZones(state) {
    const disabled = new Set();
    const phase = state.phase;
    for (const [key, def] of Object.entries(BET_DEFINITIONS)) {
        if (!ZONES[key]) continue; // odds and travelled bets render on parent zones
        if (phase === "comeout" && !def.allowedBeforePoint) disabled.add(key);
        if (phase === "point" && !def.allowedAfterPoint) disabled.add(key);
    }
    return disabled;
}

async function drawCrapsTable(state, themeColors) {
    const colors = themeColors || DEFAULT_COLORS;
    const canvas = createCanvas(CANVAS_W, CANVAS_H);
    const ctx = canvas.getContext("2d");

    await loadBackground(ctx, colors);

    const disabled = disabledZones(state);
    for (const [key, zone] of Object.entries(ZONES)) {
        drawZone(ctx, zone, colors, { disabled: disabled.has(key) });
    }

    drawHeader(ctx, state, colors);

    // Avatar load (single user — Bubble Craps).
    let avatarImg = null;
    if (state.avatarUrl) {
        if (state.avatarImg) {
            avatarImg = state.avatarImg;
        } else {
            try {
                avatarImg = await loadImage(state.avatarUrl);
                state.avatarImg = avatarImg;
            } catch { /* falls back to solid chip */ }
        }
    }
    const chipColor = state.chipColor || "#ffd700";

    const aggregated = aggregateBets(state.bets || []);
    for (const [zoneKey, info] of Object.entries(aggregated)) {
        const zone = ZONES[zoneKey];
        if (!zone) continue;
        const cx = zone.x + zone.w / 2;
        const cy = zone.y + zone.h / 2;
        drawChipStack(ctx, cx, cy, info.amount, avatarImg, chipColor);
    }

    // Footer: chip size + balance hint
    ctx.fillStyle = colors.textWhite || "#ffffff";
    ctx.font = "13px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const footer = `Chip Size: ${(state.chipSize || 0).toLocaleString('en-US')} · Phase: ${state.phase === 'comeout' ? 'COME-OUT' : `POINT ${state.point}`}`;
    ctx.fillText(footer, 10, CANVAS_H - 18);

    const buffer = canvas.toBuffer("image/png");
    return new AttachmentBuilder(buffer, { name: "craps.png" });
}

function drawDiceScene(ctx, w, h, d1, d2, colors, jitter = 0, rot = 0) {
    // Felt fill
    const grad = ctx.createRadialGradient(w / 2, h / 2, 30, w / 2, h / 2, w * 0.7);
    grad.addColorStop(0, colors.feltInner || colors.feltColor || "#237a3d");
    grad.addColorStop(1, colors.feltOuter || colors.feltDark || "#145228");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const dieSize = 110;
    const gap = 40;
    const totalW = dieSize * 2 + gap;
    const baseX1 = (w - totalW) / 2;
    const baseX2 = baseX1 + dieSize + gap;
    const baseY = (h - dieSize) / 2;

    const j = jitter || 0;
    const r1 = rot * (Math.random() - 0.5) * 2;
    const r2 = rot * (Math.random() - 0.5) * 2;
    drawDieFace(ctx, baseX1 + (Math.random() - 0.5) * j, baseY + (Math.random() - 0.5) * j, dieSize, d1, colors, r1);
    drawDieFace(ctx, baseX2 + (Math.random() - 0.5) * j, baseY + (Math.random() - 0.5) * j, dieSize, d2, colors, r2);
}

async function drawDiceAnimation(d1, d2, themeColors) {
    const colors = themeColors || DEFAULT_COLORS;
    const W = 540, H = 250;
    const TUMBLE_FRAMES = 9;
    const HOLD_FRAMES = 3;
    const FRAME_MS = 80;
    const FINAL_HOLD_MS = 500;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    const frames = [];
    for (let i = 0; i < TUMBLE_FRAMES; i++) {
        const rd1 = Math.floor(Math.random() * 6) + 1;
        const rd2 = Math.floor(Math.random() * 6) + 1;
        const easeFactor = 1 - (i / TUMBLE_FRAMES); // settles down
        drawDiceScene(ctx, W, H, rd1, rd2, colors, 18 * easeFactor, 0.6 * easeFactor);
        frames.push({ data: ctx.getImageData(0, 0, W, H).data, delay: FRAME_MS });
    }
    for (let i = 0; i < HOLD_FRAMES; i++) {
        drawDiceScene(ctx, W, H, d1, d2, colors, 0, 0);
        const delay = (i === HOLD_FRAMES - 1) ? FINAL_HOLD_MS : FRAME_MS;
        frames.push({ data: ctx.getImageData(0, 0, W, H).data, delay });
    }

    try {
        return encodeGIF(frames, { width: W, height: H, filename: "craps-roll.gif" });
    } catch (err) {
        logger.warn("Failed to encode craps dice GIF; falling back to static PNG", { error: err });
        drawDiceScene(ctx, W, H, d1, d2, colors, 0, 0);
        const buffer = canvas.toBuffer("image/png");
        return new AttachmentBuilder(buffer, { name: "craps-roll.png" });
    }
}

// Sections drive the paytable layout. Each entry shows the bet name and a
// payout string; "Come/Don't Come Odds" share the parent's true/lay odds
// description so the per-point variants don't bloat the table.
const PAYTABLE_SECTIONS = [
    {
        title: "LINE BETS",
        entries: [
            { label: "Pass Line",          payout: "1:1" },
            { label: "Don't Pass",         payout: "1:1 (12 push)" },
            { label: "Come",               payout: "1:1" },
            { label: "Don't Come",         payout: "1:1 (12 push)" },
            { label: "Pass / Come Odds",   payout: "True odds (4/10 2:1, 5/9 3:2, 6/8 6:5)" },
            { label: "Don't Pass/Come Odds", payout: "Lay odds (4/10 1:2, 5/9 2:3, 6/8 5:6)" },
        ],
    },
    {
        title: "FIELD & PLACE",
        entries: [
            { label: "Field",     payout: "1:1 (2 pays 2:1, 12 pays 3:1)" },
            { label: "Place 4",   payout: "9:5" },
            { label: "Place 10",  payout: "9:5" },
            { label: "Place 5",   payout: "7:5" },
            { label: "Place 9",   payout: "7:5" },
            { label: "Place 6",   payout: "7:6" },
            { label: "Place 8",   payout: "7:6" },
        ],
    },
    {
        title: "HARD WAYS",
        entries: [
            { label: "Hard 4",  payout: "7:1" },
            { label: "Hard 10", payout: "7:1" },
            { label: "Hard 6",  payout: "9:1" },
            { label: "Hard 8",  payout: "9:1" },
        ],
    },
    {
        title: "BIG BETS & PROPS",
        entries: [
            { label: "Big 6",          payout: "1:1" },
            { label: "Big 8",          payout: "1:1" },
            { label: "Any 7",          payout: "4:1" },
            { label: "Any Craps",      payout: "7:1" },
            { label: "Yo (11)",        payout: "15:1" },
            { label: "Ace-Deuce (3)",  payout: "15:1" },
            { label: "Aces (2)",       payout: "30:1" },
            { label: "Boxcars (12)",   payout: "30:1" },
            { label: "C & E",          payout: "Craps 7:1 / Yo 15:1 (split)" },
            { label: "Horn",           payout: "2/12 30:1, 3/11 15:1 (split)" },
        ],
    },
];

const EXPLANATION_LINES = [
    "Roll two dice. Each round starts with a \"come-out\" roll.",
    "Roll 7 or 11 → Pass wins. 2 / 3 / 12 → Pass loses (craps).",
    "Any other roll sets the \"point\"; keep rolling until the point",
    "repeats (Pass wins) or a 7 lands first (seven-out — Pass loses).",
];

async function drawPaytable(themeColors) {
    const colors = themeColors || DEFAULT_COLORS;
    const c = colors;

    const PT_W = 750;
    const PADDING = 20;
    const titleY = 38;

    // Explanation panel
    const explTop = 55;
    const explLineH = 18;
    const explPadding = 12;
    const explH = explLineH * EXPLANATION_LINES.length + explPadding * 2;

    // Layout sections
    const sectionGap = 12;
    const sectionHeaderH = 28;
    const rowH = 26;
    const colCount = 2;

    // Pre-compute each section's row count for layout.
    const sectionLayouts = PAYTABLE_SECTIONS.map(sec => {
        const rows = Math.ceil(sec.entries.length / colCount);
        return { ...sec, rows, height: sectionHeaderH + rows * rowH + 4 };
    });

    let cursorY = explTop + explH + sectionGap + 10;
    for (const sec of sectionLayouts) {
        sec.startY = cursorY;
        cursorY += sec.height + sectionGap;
    }
    const rulesY = cursorY + 6;
    const PT_H = rulesY + 40 + PADDING;

    const canvas = createCanvas(PT_W, PT_H);
    const ctx = canvas.getContext("2d");

    // Outer felt-dark backdrop with rounded inner panel — matches slots paytable look.
    ctx.fillStyle = c.feltDark || c.feltOuter || "#0a3a1a";
    ctx.fillRect(0, 0, PT_W, PT_H);
    roundRect(ctx, 8, 8, PT_W - 16, PT_H - 16, 12);
    ctx.fillStyle = c.feltColor || c.feltMid || "#0f4c25";
    ctx.fill();
    ctx.strokeStyle = c.layoutLine || c.gold || "#ffd700";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Title
    ctx.font = "bold 24px Arial";
    ctx.fillStyle = c.textPrimary || c.gold || "#ffd700";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("CRAPS PAYTABLE", PT_W / 2, titleY);

    // Explanation banner
    const explX = PADDING + 12;
    const explW = PT_W - (PADDING + 12) * 2;
    roundRect(ctx, explX, explTop, explW, explH, 8);
    ctx.fillStyle = c.bannerBackground || c.feltDark || "rgba(0,0,0,0.35)";
    ctx.fill();
    ctx.strokeStyle = c.layoutLine || c.gold || "#ffd700";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = "13px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = c.textWhite || "#ffffff";
    for (let i = 0; i < EXPLANATION_LINES.length; i++) {
        const ly = explTop + explPadding + explLineH / 2 + i * explLineH;
        ctx.fillText(EXPLANATION_LINES[i], PT_W / 2, ly);
    }

    // Sections
    for (const sec of sectionLayouts) {
        // Section header bar (banner-style, matches slots paytable jackpot banner)
        const bx = PADDING + 4;
        const bw = PT_W - (PADDING + 4) * 2;
        roundRect(ctx, bx, sec.startY, bw, sectionHeaderH, 6);
        ctx.fillStyle = c.bannerBackground || c.feltDark || "rgba(0,0,0,0.45)";
        ctx.fill();
        ctx.strokeStyle = c.layoutLine || c.gold || "#ffd700";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.font = "bold 14px Arial";
        ctx.fillStyle = c.textPrimary || c.gold || "#ffd700";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(sec.title, PT_W / 2, sec.startY + sectionHeaderH / 2);

        // Rows in 2-column grid
        const colW = (bw - 16) / colCount;
        const colStartX = bx + 8;
        const rowStartY = sec.startY + sectionHeaderH + 4;

        for (let idx = 0; idx < sec.entries.length; idx++) {
            const e = sec.entries[idx];
            const col = idx % colCount;
            const row = Math.floor(idx / colCount);
            const cellX = colStartX + col * colW;
            const cellY = rowStartY + row * rowH;

            // Subtle stripe on alternate rows so dense entries are scannable.
            if (row % 2 === 0) {
                ctx.fillStyle = "rgba(255,255,255,0.04)";
                ctx.fillRect(cellX, cellY, colW, rowH);
            }

            ctx.font = "bold 12px Arial";
            ctx.fillStyle = c.textWhite || "#ffffff";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(e.label, cellX + 8, cellY + rowH / 2);

            ctx.font = "11px Arial";
            ctx.fillStyle = c.textWin || c.gold || "#ffd700";
            ctx.textAlign = "right";
            ctx.fillText(e.payout, cellX + colW - 8, cellY + rowH / 2);
        }
    }

    // Separator above rules
    ctx.strokeStyle = c.frameDarkColor || c.layoutLine || c.gold || "#c8a830";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PADDING + 20, rulesY - 2);
    ctx.lineTo(PT_W - PADDING - 20, rulesY - 2);
    ctx.stroke();

    // Rules
    ctx.font = "11px Arial";
    ctx.fillStyle = "#aaaaaa";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Place bets at any time; click 🎲 Roll to throw. Place / Come / Hard / Odds bets unlock once a point is set.", PT_W / 2, rulesY + 12);
    ctx.fillText("Bets stay on the table between rolls until they win, lose, or you Clear them.", PT_W / 2, rulesY + 28);

    const buffer = canvas.toBuffer("image/png");
    return new AttachmentBuilder(buffer, { name: "craps-paytable.png" });
}

async function crapsPreview(themeId) {
    const colors = getThemeColors(themeId, "craps");
    return drawCrapsTable({ phase: "comeout", point: null, bets: [], chipSize: 0 }, colors);
}

module.exports = {
    drawCrapsTable,
    drawDiceAnimation,
    drawPaytable,
    crapsPreview,
    ZONES,
    CANVAS_W,
    CANVAS_H,
};
