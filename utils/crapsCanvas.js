const { createCanvas, loadImage } = require("canvas");
const { AttachmentBuilder } = require("discord.js");
const { getThemeColors } = require("../themes/resolver");
const { encodeGIF } = require("./gifUtil");
const { BET_DEFINITIONS } = require("./craps");
const logger = require("./logger");

const DEFAULT_COLORS = getThemeColors("classic", "craps");

const BG_CACHE = new Map();
const AVATAR_CACHE = new Map();

const CANVAS_W = 1100;
const CANVAS_H = 500;

// Five-zone Street Craps layout. Field spans the top, the two prop boxes sit
// side-by-side underneath, then Don't Pass and Pass run as full-width rails at
// the bottom (Pass biggest since it carries the most chips).
const ZONES = {
    field:    { x: 30,  y: 80,  w: 1040, h: 110, label: "FIELD",
                payoutText: "3/4/9/10/11 (1:1) · 2 (2:1) · 12 (3:1)", colorKey: "fieldColor" },
    any7:     { x: 30,  y: 210, w: 510,  h: 90,  label: "ANY 7",
                payoutText: "4:1", colorKey: "propsColor" },
    anyCraps: { x: 560, y: 210, w: 510,  h: 90,  label: "ANY CRAPS",
                payoutText: "7:1 (2 · 3 · 12)", colorKey: "propsColor" },
    dontPass: { x: 30,  y: 320, w: 1040, h: 60,  label: "DON'T PASS BAR",
                payoutText: "1:1 (come-out only · 12 push)", colorKey: "dontPassColor" },
    pass:     { x: 30,  y: 390, w: 1040, h: 80,  label: "PASS LINE",
                payoutText: "1:1 (come-out only)", colorKey: "passLineColor" },
};

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

    if (opts.disabled) {
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        roundRect(ctx, zone.x, zone.y, zone.w, zone.h, 8);
        ctx.fill();
    }

    ctx.fillStyle = labelColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const cx = zone.x + zone.w / 2;
    const labelFont = Math.min(22, Math.max(13, zone.h * 0.28));
    ctx.font = `bold ${Math.round(labelFont)}px Arial`;
    const labelY = zone.payoutText ? zone.y + zone.h * 0.34 : zone.y + zone.h / 2;
    ctx.fillText(zone.label, cx, labelY);

    if (zone.payoutText) {
        ctx.font = `${Math.round(labelFont * 0.65)}px Arial`;
        ctx.fillStyle = colors.gold || "#ffd700";
        ctx.fillText(zone.payoutText, cx, zone.y + zone.h * 0.68);
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

function drawShooterBadge(ctx, state, colors) {
    const name = state.shooterUsername;
    if (!name) return;
    const badgeX = 120;
    const badgeY = 14;
    const badgeH = 36;
    ctx.font = "bold 14px Arial";
    const labelText = `SHOOTER: ${name}`;
    const textW = ctx.measureText(labelText).width;
    const badgeW = Math.min(textW + 28, 360);

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 10);
    ctx.fillStyle = colors.puckOn || "#ffffff";
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = colors.gold || "#ffd700";
    ctx.lineWidth = 2;
    roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 10);
    ctx.stroke();

    ctx.fillStyle = colors.puckText || "#000000";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "bold 14px Arial";
    const truncated = textW > badgeW - 28 ? `SHOOTER: ${name.slice(0, 18)}…` : labelText;
    ctx.fillText(truncated, badgeX + 14, badgeY + badgeH / 2);
}

function drawHeader(ctx, state, colors) {
    ctx.fillStyle = colors.gold || "#ffd700";
    ctx.font = "bold 32px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("CRAPS", CANVAS_W / 2, 32);

    drawPuck(ctx, 70, 32, state.point, colors);
    drawShooterBadge(ctx, state, colors);

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
            ctx.fillStyle = colors.feltColor || "rgba(15, 76, 37, 0.6)";
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
            return;
        } catch (err) {
            logger.warn(`Failed to load craps background image, using fallback color: ${err}`);
        }
    }
    const grad = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H / 2, 50, CANVAS_W / 2, CANVAS_H / 2, CANVAS_W * 0.7);
    grad.addColorStop(0, colors.feltInner || colors.feltColor || "#237a3d");
    grad.addColorStop(0.7, colors.feltMid || colors.feltColor || "#1a6b35");
    grad.addColorStop(1, colors.feltOuter || colors.feltDark || "#145228");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

// { [zoneKey]: { [userId]: { amount } } } so the renderer can lay out one chip
// per user per zone with per-user colors and avatars.
function aggregateBets(bets) {
    const out = {};
    for (const bet of bets) {
        if (!BET_DEFINITIONS[bet.betKey]) continue;
        const zk = bet.betKey;
        if (!out[zk]) out[zk] = {};
        if (!out[zk][bet.userId]) out[zk][bet.userId] = { amount: 0 };
        out[zk][bet.userId].amount += bet.amount;
    }
    return out;
}

function disabledZones(state) {
    const disabled = new Set();
    const phase = state.phase;
    for (const [key, def] of Object.entries(BET_DEFINITIONS)) {
        if (!ZONES[key]) continue;
        if (phase === "comeout" && !def.allowedBeforePoint) disabled.add(key);
        if (phase === "point" && !def.allowedAfterPoint) disabled.add(key);
    }
    return disabled;
}

async function resolveAvatars(userAvatars) {
    if (!userAvatars) return {};
    const out = {};
    const entries = Object.entries(userAvatars);
    await Promise.all(entries.map(async ([uid, url]) => {
        if (!url) return;
        if (AVATAR_CACHE.has(url)) {
            out[uid] = AVATAR_CACHE.get(url);
            return;
        }
        try {
            const img = await loadImage(url);
            AVATAR_CACHE.set(url, img);
            out[uid] = img;
        } catch {
            // Skip — chip falls back to a solid color
        }
    }));
    return out;
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

    const avatars = await resolveAvatars(state.userAvatars || {});
    const userColors = state.userColors || {};
    const aggregated = aggregateBets(state.bets || []);

    for (const [zoneKey, userMap] of Object.entries(aggregated)) {
        const zone = ZONES[zoneKey];
        if (!zone) continue;
        const users = Object.entries(userMap);
        const N = users.length;
        const spacing = Math.min(54, Math.max(46, (zone.w - 40) / Math.max(N, 1)));
        const totalW = (N - 1) * spacing;
        const startX = zone.x + zone.w / 2 - totalW / 2;
        const cy = zone.y + zone.h / 2 + (zone.payoutText ? -4 : 0);
        for (let i = 0; i < N; i++) {
            const [uid, info] = users[i];
            const cx = startX + i * spacing;
            drawChipStack(ctx, cx, cy, info.amount, avatars[uid] || null, userColors[uid] || "#ffd700");
        }
    }

    ctx.fillStyle = colors.textWhite || "#ffffff";
    ctx.font = "13px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const phaseLabel = state.phase === "point" ? `POINT ${state.point}` : "COME-OUT";
    const playerCount = state.shooterOrder ? state.shooterOrder.length : 0;
    const footer = `Phase: ${phaseLabel} · Players: ${playerCount}`;
    ctx.fillText(footer, 14, CANVAS_H - 18);

    const buffer = canvas.toBuffer("image/png");
    return new AttachmentBuilder(buffer, { name: "craps.png" });
}

function drawDiceScene(ctx, w, h, d1, d2, colors, jitter = 0, rot = 0) {
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
        const easeFactor = 1 - (i / TUMBLE_FRAMES);
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
        logger.warn(`Failed to encode craps dice GIF; falling back to static PNG: ${err}`);
        drawDiceScene(ctx, W, H, d1, d2, colors, 0, 0);
        const buffer = canvas.toBuffer("image/png");
        return new AttachmentBuilder(buffer, { name: "craps-roll.png" });
    }
}

const PAYTABLE_ENTRIES = [
    { label: "Pass Line",   payout: "1:1",   note: "Come-out only. 7/11 win, 2/3/12 lose, else point." },
    { label: "Don't Pass",  payout: "1:1",   note: "Come-out only. 2/3 win, 12 push, 7/11 lose, else point." },
    { label: "Field",       payout: "1:1",   note: "One-roll. 3/4/9/10/11 pay 1:1, 2 pays 2:1, 12 pays 3:1." },
    { label: "Any 7",       payout: "4:1",   note: "One-roll. Wins only on a 7." },
    { label: "Any Craps",   payout: "7:1",   note: "One-roll. Wins on 2, 3, or 12." },
];

const EXPLANATION_LINES = [
    "Roll two dice. Each round starts with a \"come-out\" roll.",
    "Pass: 7/11 win, 2/3/12 lose, anything else sets the point.",
    "Once a point is set, the shooter rolls until the point repeats",
    "(Pass wins) or a 7 lands first (seven-out — Pass loses, new shooter).",
    "Field / Any 7 / Any Craps are one-roll side bets; place them anytime.",
];

async function drawPaytable(themeColors) {
    const colors = themeColors || DEFAULT_COLORS;
    const c = colors;

    const PT_W = 720;
    const PADDING = 20;
    const titleY = 38;

    const explTop = 55;
    const explLineH = 18;
    const explPadding = 12;
    const explH = explLineH * EXPLANATION_LINES.length + explPadding * 2;

    const rowH = 56;
    const rowGap = 8;
    const rowsTop = explTop + explH + 20;
    const totalRowsH = PAYTABLE_ENTRIES.length * (rowH + rowGap);
    const rulesY = rowsTop + totalRowsH + 10;
    const PT_H = rulesY + 40 + PADDING;

    const canvas = createCanvas(PT_W, PT_H);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = c.feltDark || c.feltOuter || "#0a3a1a";
    ctx.fillRect(0, 0, PT_W, PT_H);
    roundRect(ctx, 8, 8, PT_W - 16, PT_H - 16, 12);
    ctx.fillStyle = c.feltColor || c.feltMid || "#0f4c25";
    ctx.fill();
    ctx.strokeStyle = c.layoutLine || c.gold || "#ffd700";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.font = "bold 24px Arial";
    ctx.fillStyle = c.textPrimary || c.gold || "#ffd700";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("CRAPS PAYTABLE", PT_W / 2, titleY);

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

    const rowX = PADDING + 4;
    const rowW = PT_W - (PADDING + 4) * 2;
    for (let i = 0; i < PAYTABLE_ENTRIES.length; i++) {
        const e = PAYTABLE_ENTRIES[i];
        const ry = rowsTop + i * (rowH + rowGap);

        roundRect(ctx, rowX, ry, rowW, rowH, 8);
        ctx.fillStyle = c.bannerBackground || c.feltDark || "rgba(0,0,0,0.4)";
        ctx.fill();
        ctx.strokeStyle = c.layoutLine || c.gold || "#ffd700";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.font = "bold 16px Arial";
        ctx.fillStyle = c.textWhite || "#ffffff";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(e.label, rowX + 14, ry + 18);

        ctx.font = "12px Arial";
        ctx.fillStyle = "#cccccc";
        ctx.fillText(e.note, rowX + 14, ry + 38);

        ctx.font = "bold 18px Arial";
        ctx.fillStyle = c.textWin || c.gold || "#ffd700";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(e.payout, rowX + rowW - 16, ry + rowH / 2);
    }

    ctx.strokeStyle = c.frameDarkColor || c.layoutLine || c.gold || "#c8a830";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PADDING + 20, rulesY - 2);
    ctx.lineTo(PT_W - PADDING - 20, rulesY - 2);
    ctx.stroke();

    ctx.font = "11px Arial";
    ctx.fillStyle = "#aaaaaa";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Multiple players can join the same session. Only the shooter can roll.", PT_W / 2, rulesY + 12);
    ctx.fillText("Pass / Don't Pass: come-out only. Side bets: any time. Shooter rotates on a seven-out.", PT_W / 2, rulesY + 28);

    const buffer = canvas.toBuffer("image/png");
    return new AttachmentBuilder(buffer, { name: "craps-paytable.png" });
}

async function crapsPreview(themeId) {
    const colors = getThemeColors(themeId, "craps");
    return drawCrapsTable({ phase: "comeout", point: null, bets: [], shooterOrder: [] }, colors);
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
