const { createCanvas } = require("canvas");
const { AttachmentBuilder } = require("discord.js");
const { getThemeColors } = require("../themes/resolver");
const { encodeGIF } = require("./gifUtil");
const { BET_DEFINITIONS } = require("./craps");
const logger = require("./logger");
const {
  withAlpha,
  roundRect,
  drawBackground,
  drawAtmosphere,
  drawTitle,
  drawPanel,
  drawPanelHeading,
  drawAvatarCircle,
  loadAvatarByUrl,
} = require("./canvasCommon");

const DEFAULT_COLORS = getThemeColors("classic", "craps");


const CANVAS_W = 1280;
const CANVAS_H = 720;

const MARGIN = 28;
const HEADER_H = 84;
const LEFT_COL_X = MARGIN;
const LEFT_COL_W = 286;
const SPOTLIGHT_H = 244;
const ROSTER_GAP = 14;
const ROSTER_X = LEFT_COL_X;
const ROSTER_Y = MARGIN + HEADER_H + 20 + SPOTLIGHT_H + ROSTER_GAP;
const ROSTER_H = CANVAS_H - ROSTER_Y - MARGIN;

const TABLE_X = LEFT_COL_X + LEFT_COL_W + 22;
const TABLE_Y = MARGIN + HEADER_H + 20;
const TABLE_W = CANVAS_W - TABLE_X - MARGIN;
const TABLE_H = CANVAS_H - TABLE_Y - MARGIN;

const TABLE_PAD = 18;
const HISTORY_H = 92;
const ZONES_INNER_Y = TABLE_Y + TABLE_PAD;
const ZONES_INNER_H = TABLE_H - TABLE_PAD * 2 - HISTORY_H - 12;
const ZONES_INNER_X = TABLE_X + TABLE_PAD;
const ZONES_INNER_W = TABLE_W - TABLE_PAD * 2;

// Five-zone Street Craps layout, sized to the inner table region. Field tops
// the surface, the two prop boxes split the next row, then Don't Pass and Pass
// run as full-width rails (Pass tallest since it carries the most chips).
function computeZones() {
  const x = ZONES_INNER_X;
  const w = ZONES_INNER_W;
  const top = ZONES_INNER_Y;

  const fieldH = Math.round(ZONES_INNER_H * 0.24);
  const propsH = Math.round(ZONES_INNER_H * 0.22);
  const dontH  = Math.round(ZONES_INNER_H * 0.18);
  const gap = Math.max(8, Math.round(ZONES_INNER_H * 0.025));
  const passH = ZONES_INNER_H - fieldH - propsH - dontH - gap * 3;

  const y1 = top;
  const y2 = y1 + fieldH + gap;
  const y3 = y2 + propsH + gap;
  const y4 = y3 + dontH + gap;
  const halfW = (w - gap) / 2;

  return {
    field:    { x, y: y1, w, h: fieldH, label: "FIELD",
      payoutText: "3·4·9·10·11 (1:1) · 2 (2:1) · 12 (3:1)", colorKey: "fieldColor" },
    any7:     { x, y: y2, w: halfW, h: propsH, label: "ANY 7",
      payoutText: "4:1 (one roll)", colorKey: "propsColor" },
    anyCraps: { x: x + halfW + gap, y: y2, w: halfW, h: propsH, label: "ANY CRAPS",
      payoutText: "7:1 (2 · 3 · 12)", colorKey: "propsColor" },
    dontPass: { x, y: y3, w, h: dontH, label: "DON'T PASS BAR",
      payoutText: "1:1 (come-out · 12 push)", colorKey: "dontPassColor" },
    pass:     { x, y: y4, w, h: passH, label: "PASS LINE",
      payoutText: "1:1 (come-out)", colorKey: "passLineColor" },
  };
}

const ZONES = computeZones();

const PIP_POSITIONS = {
  1: [[0.5, 0.5]],
  2: [[0.25, 0.25], [0.75, 0.75]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.5], [0.75, 0.5], [0.25, 0.75], [0.75, 0.75]],
};


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

function formatChipAmount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString("en-US");
}

function drawChipStack(ctx, cx, cy, amount, avatarImg, chipColor) {
  const R = 17;
  const RIM_IN = 12;
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

  // Amount stamped on the chip face (lower-arc band). Keeps every chip
  // self-contained so the zone label / payout text above stays uncluttered.
  const tag = formatChipAmount(amount);
  ctx.save();
  const bandH = 13;
  const bandY = cy + RIM_IN - bandH + 1;
  ctx.beginPath();
  ctx.arc(cx, cy, RIM_IN - 1, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(cx - RIM_IN, bandY, RIM_IN * 2, bandH);
  ctx.restore();

  ctx.save();
  ctx.font = "bold 8px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(tag, cx, bandY + bandH / 2 - 2.5);
  ctx.restore();
}

function drawZone(ctx, zone, colors, opts = {}) {
  const baseFill = colors[zone.colorKey] || colors.tableGreen || "#1a6b35";
  const fill = opts.highlight ? (colors.winnerHighlight || colors.gold || "#ffd700") : baseFill;
  const border = colors.layoutLine || colors.gold || "#ffd700";
  const labelColor = colors.layoutLabel || colors.textWhite || "#ffffff";

  ctx.fillStyle = fill;
  roundRect(ctx, zone.x, zone.y, zone.w, zone.h, 10);
  ctx.fill();

  ctx.strokeStyle = border;
  ctx.lineWidth = opts.highlight ? 3 : 1.5;
  roundRect(ctx, zone.x, zone.y, zone.w, zone.h, 10);
  ctx.stroke();

  if (opts.disabled) {
    ctx.save();
    roundRect(ctx, zone.x, zone.y, zone.w, zone.h, 10);
    ctx.clip();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
    ctx.restore();
  }

  // Fixed top-margin layout: label 22px from zone top, payout 18px below
  // that. Positions are absolute rather than percentage-of-height so all
  // zones share the same visual top-padding regardless of how tall they are.
  const cx = zone.x + zone.w / 2;
  const tall = zone.h >= 80;
  const LABEL_Y  = zone.y + 22;
  const PAYOUT_Y = zone.y + 40;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.65)";
  ctx.shadowBlur = 5;

  ctx.font = "bold 18px Arial";
  ctx.fillStyle = labelColor;
  ctx.fillText(zone.label, cx, LABEL_Y);

  if (tall && zone.payoutText) {
    ctx.font = "12px Arial";
    ctx.fillStyle = colors.gold || "#ffd700";
    ctx.fillText(zone.payoutText, cx, PAYOUT_Y);
  }

  ctx.shadowBlur = 0;
}

function drawPuck(ctx, x, y, point, colors) {
  const r = 30;
  const on = point != null;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = on ? (colors.puckOn || "#ffffff") : (colors.puckOff || "#1a1a1a");
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = colors.gold || "#ffd700";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = withAlpha(colors.gold || "#ffd700", 0.45);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r + 5, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = on ? (colors.puckText || "#000000") : (colors.textWhite || "#ffffff");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (on) {
    ctx.font = "bold 10px Arial";
    ctx.fillText("ON", x, y - 10);
    ctx.font = "bold 24px Arial";
    ctx.fillText(String(point), x, y + 7);
  } else {
    ctx.font = "bold 16px Arial";
    ctx.fillText("OFF", x, y);
  }
}

function drawHeader(ctx, state, colors) {
  const gold = colors.gold || "#ffd700";
  const felt = colors.feltColor || colors.feltDark || "#0f4c25";

  drawTitle(ctx, CANVAS_W / 2, MARGIN + 32, "CRAPS", gold, colors, { shadowBlur: 12 });

  // Phase ribbon directly under the title.
  const ribbonText = state.phase === "point"
    ? `POINT • ${state.point} — shooting for the point`
    : "COME-OUT ROLL";
  ctx.save();
  ctx.font = "bold 14px Arial";
  const textW = ctx.measureText(ribbonText).width;
  const padX = 18;
  const rw = Math.min(420, textW + padX * 2);
  const rh = 24;
  const rx = CANVAS_W / 2 - rw / 2;
  const ry = MARGIN + 60;
  roundRect(ctx, rx, ry, rw, rh, rh / 2);
  ctx.fillStyle = withAlpha(felt, 0.75);
  ctx.fill();
  ctx.strokeStyle = withAlpha(gold, 0.7);
  ctx.lineWidth = 1.25;
  ctx.stroke();
  ctx.fillStyle = gold;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(ribbonText, CANVAS_W / 2, ry + rh / 2 + 1);
  ctx.restore();

  drawPuck(ctx, MARGIN + 44, MARGIN + 38, state.point, colors);

  if (state.lastRoll) {
    const { d1, d2 } = state.lastRoll;
    const dieSize = 54;
    const gap = 10;
    const totalW = dieSize * 2 + gap;
    const dx = CANVAS_W - MARGIN - totalW;
    const dy = MARGIN + 4;
    ctx.save();
    ctx.font = "bold 11px Arial";
    ctx.fillStyle = withAlpha(gold, 0.85);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("LAST ROLL", dx + totalW / 2, dy - 2);
    ctx.restore();
    drawDieFace(ctx, dx, dy + 12, dieSize, d1, colors);
    drawDieFace(ctx, dx + dieSize + gap, dy + 12, dieSize, d2, colors);
  }
}

function truncateToWidth(ctx, text, maxWidth) {
  if (!text) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + "…";
}

function drawShooterSpotlight(ctx, state, avatars, colors) {
  const x = LEFT_COL_X;
  const y = MARGIN + HEADER_H + 20;
  const w = LEFT_COL_W;
  const h = SPOTLIGHT_H;
  const gold = colors.gold || "#ffd700";
  const winColor = colors.textWin || "#44ff44";
  const lossColor = colors.textLoss || "#ff4444";

  drawPanel(ctx, x, y, w, h, colors, { accent: true });
  drawPanelHeading(ctx, x, y, w, "SHOOTER", colors);

  const shooterId = state.shooterId;
  const avatarImg = shooterId ? avatars[shooterId] : null;
  const ringColor = (state.userColors && shooterId && state.userColors[shooterId]) || gold;

  const avatarCX = x + w / 2;
  const avatarCY = y + 78;
  const radius = 44;

  // Subtle radial glow — tighter radius and lower opacity than before.
  ctx.save();
  const glow = ctx.createRadialGradient(avatarCX, avatarCY, 4, avatarCX, avatarCY, 72);
  glow.addColorStop(0, withAlpha(ringColor, 0.28));
  glow.addColorStop(1, withAlpha(ringColor, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(avatarCX - 80, avatarCY - 80, 160, 160);
  ctx.restore();

  // Single ring only — the outer faded ring added noise without clarity.
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = withAlpha(ringColor, 0.72);
  ctx.beginPath();
  ctx.arc(avatarCX, avatarCY, radius + 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  drawAvatarCircle(ctx, avatarCX, avatarCY, radius, avatarImg, ringColor, colors.feltDark);

  // Shooter name.
  ctx.save();
  ctx.font = "bold 19px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const nameMax = w - 28;
  const name = truncateToWidth(ctx, state.shooterUsername || "—", nameMax);
  ctx.fillStyle = colors.textWhite || "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 4;
  ctx.fillText(name, x + w / 2, y + 154);
  ctx.shadowBlur = 0;
  ctx.restore();

  // Phase / streak line.
  const streak = state.shooterStreak || 0;
  let subText;
  if (state.phase === "point") {
    subText = `Shooting for ${state.point}`;
  } else if (streak > 0) {
    subText = `Hot hand · ${streak} clean roll${streak === 1 ? "" : "s"}`;
  } else {
    subText = "Come-out roll";
  }
  ctx.save();
  ctx.font = "12px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = withAlpha(gold, 0.9);
  ctx.fillText(subText, x + w / 2, y + 176);
  ctx.restore();

  // Wagered / won mini stats.
  const totals = (state.totals && shooterId && state.totals[shooterId]) || { wagered: 0, won: 0 };
  const statY = y + h - 30;
  const colW = w / 2;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = "10px Arial";
  ctx.fillStyle = withAlpha(colors.textWhite || "#fff", 0.6);
  ctx.fillText("WAGERED", x + colW / 2, statY);
  ctx.fillText("WON", x + colW + colW / 2, statY);
  ctx.font = "bold 16px Arial";
  ctx.fillStyle = gold;
  ctx.fillText(totals.wagered.toLocaleString("en-US"), x + colW / 2, statY + 18);
  ctx.fillStyle = totals.won > 0 ? winColor : (totals.won < 0 ? lossColor : colors.textWhite);
  ctx.fillText(totals.won.toLocaleString("en-US"), x + colW + colW / 2, statY + 18);
  ctx.restore();
}

function drawPlayerRoster(ctx, state, avatars, colors) {
  const x = ROSTER_X;
  const y = ROSTER_Y;
  const w = LEFT_COL_W;
  const h = ROSTER_H;
  const gold = colors.gold || "#ffd700";

  drawPanel(ctx, x, y, w, h, colors);
  const order = state.shooterOrder || [];
  const heading = `AT THE TABLE · ${order.length}`;
  drawPanelHeading(ctx, x, y, w, heading, colors);

  if (order.length === 0) {
    ctx.save();
    ctx.font = "italic 13px Arial";
    ctx.fillStyle = withAlpha(colors.textWhite || "#fff", 0.55);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No players yet — place a bet to join.", x + w / 2, y + h / 2);
    ctx.restore();
    return;
  }

  // Aggregate per-user pending stake across all bets so the roster shows
  // current exposure, not just historical wagered.
  const pendingByUser = {};
  for (const bet of (state.bets || [])) {
    pendingByUser[bet.userId] = (pendingByUser[bet.userId] || 0) + bet.amount;
  }

  const rowH = 46;
  const top = y + 38;
  const visible = Math.min(order.length, Math.floor((h - 50) / rowH));

  for (let i = 0; i < visible; i++) {
    const uid = order[i];
    const ry = top + i * rowH;
    const isShooter = uid === state.shooterId;
    const totals = (state.totals && state.totals[uid]) || { wagered: 0, won: 0 };
    const username = (state.totals && state.totals[uid] && state.totals[uid].username)
            || (state.userNames && state.userNames[uid])
            || (isShooter ? state.shooterUsername : null)
            || "Player";
    const ringColor = (state.userColors && state.userColors[uid]) || gold;

    // Row highlight for the active shooter.
    if (isShooter) {
      ctx.save();
      ctx.fillStyle = withAlpha(ringColor, 0.14);
      roundRect(ctx, x + 8, ry - 4, w - 16, rowH - 4, 8);
      ctx.fill();
      ctx.strokeStyle = withAlpha(ringColor, 0.55);
      ctx.lineWidth = 1;
      roundRect(ctx, x + 8, ry - 4, w - 16, rowH - 4, 8);
      ctx.stroke();
      ctx.restore();
    }

    const avRadius = 16;
    const avCX = x + 14 + avRadius;
    const avCY = ry + (rowH - 8) / 2;
    drawAvatarCircle(ctx, avCX, avCY, avRadius, avatars[uid], ringColor, colors.feltDark);

    if (isShooter) {
      // Dice glyph next to the avatar so the shooter is unambiguous.
      ctx.save();
      ctx.font = "12px Arial";
      ctx.fillStyle = gold;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("🎲", avCX + avRadius + 18, avCY);
      ctx.restore();
    }

    const textX = avCX + avRadius + (isShooter ? 30 : 12);
    const textRightLimit = x + w - 14;

    const wager = pendingByUser[uid] || 0;
    const won = totals.won || 0;
    const winColor = colors.textWin || "#44ff44";
    const lossColor = colors.textLoss || "#ff4444";
    const wonText = won > 0 ? `+${won.toLocaleString("en-US")}` : won.toLocaleString("en-US");
    const wonColor = won > 0 ? winColor : (won < 0 ? lossColor : withAlpha(colors.textWhite || "#fff", 0.4));

    ctx.save();
    ctx.textBaseline = "alphabetic";

    // Measure won-amount first so name truncation avoids a collision.
    ctx.font = "bold 12px Arial";
    const wonW = ctx.measureText(wonText).width;
    const nameMaxW = textRightLimit - textX - wonW - 10;

    // Row 1: name (left) · session net (right) — shared alphabetic baseline.
    ctx.font = "bold 13px Arial";
    ctx.textAlign = "left";
    ctx.fillStyle = colors.textWhite || "#ffffff";
    ctx.fillText(truncateToWidth(ctx, username, nameMaxW), textX, ry + 17);

    ctx.font = "bold 12px Arial";
    ctx.textAlign = "right";
    ctx.fillStyle = wonColor;
    ctx.fillText(wonText, textRightLimit, ry + 17);

    // Row 2: current wager exposure.
    const wagerLabel = wager > 0 ? `${wager.toLocaleString("en-US")} on table` : "no bets up";
    ctx.font = "11px Arial";
    ctx.textAlign = "left";
    ctx.fillStyle = wager > 0 ? withAlpha(gold, 0.9) : withAlpha(colors.textWhite || "#fff", 0.5);
    ctx.fillText(wagerLabel, textX, ry + 32);
    ctx.restore();
  }

  // Overflow indicator.
  if (order.length > visible) {
    ctx.save();
    ctx.font = "italic 11px Arial";
    ctx.fillStyle = withAlpha(colors.textWhite || "#fff", 0.55);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`+${order.length - visible} more`, x + w / 2, y + h - 10);
    ctx.restore();
  }
}

const ROLL_BADGE_COLOR = {
  sevenOut:  "#c0392b",
  pointHit:  "#2ecc71",
  pointSet:  "#3498db",
  pass:      "#27ae60",
  crap:      "#a8442e",
  natural:   "#27ae60",
  neutral:   "#7f8c8d",
};

function classifyRoll(roll) {
  if (!roll || roll.kind) return roll && roll.kind ? roll.kind : "neutral";
  return "neutral";
}

function drawRollHistory(ctx, state, colors) {
  const x = ZONES_INNER_X;
  const w = ZONES_INNER_W;
  const y = TABLE_Y + TABLE_H - TABLE_PAD - HISTORY_H;
  const h = HISTORY_H;
  const gold = colors.gold || "#ffd700";

  // Subtle inner shelf so the strip reads as part of the table felt.
  ctx.save();
  ctx.fillStyle = withAlpha(colors.feltDark || colors.feltOuter || "#0a3a1a", 0.55);
  roundRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.strokeStyle = withAlpha(gold, 0.45);
  ctx.lineWidth = 1.25;
  roundRect(ctx, x, y, w, h, 10);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.font = "bold 11px Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = withAlpha(gold, 0.9);
  ctx.fillText("ROLL HISTORY", x + 14, y + 16);
  ctx.restore();

  const history = (state.rollHistory || []).slice(-10);
  if (history.length === 0) {
    ctx.save();
    ctx.font = "italic 12px Arial";
    ctx.fillStyle = withAlpha(colors.textWhite || "#fff", 0.5);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No rolls yet — the shooter is up.", x + w / 2, y + h / 2 + 8);
    ctx.restore();
    return;
  }

  // Lay out chips right-aligned (newest at the right), but render left→right
  // chronologically so the eye reads timeline order with the latest popping.
  const chipW = 78;
  const chipGap = 10;
  const stripPadL = 14;
  const stripPadR = 14;
  const stripTop = y + 26;
  const stripH = h - 32;
  const usable = w - stripPadL - stripPadR;
  const maxFit = Math.max(1, Math.floor((usable + chipGap) / (chipW + chipGap)));
  const shown = history.slice(-maxFit);
  const totalW = shown.length * chipW + (shown.length - 1) * chipGap;
  const startX = x + w - stripPadR - totalW;

  for (let i = 0; i < shown.length; i++) {
    const entry = shown[i];
    const cx = startX + i * (chipW + chipGap);
    drawRollChip(ctx, cx, stripTop, chipW, stripH, entry, colors, i === shown.length - 1);
  }
}

function drawRollChip(ctx, x, y, w, h, entry, colors, isLatest) {
  const gold = colors.gold || "#ffd700";
  const badgeColor = ROLL_BADGE_COLOR[entry.kind] || ROLL_BADGE_COLOR.neutral;
  const felt = colors.feltDark || "#0a3a1a";

  ctx.save();
  ctx.shadowColor = isLatest ? withAlpha(gold, 0.55) : "rgba(0,0,0,0.3)";
  ctx.shadowBlur = isLatest ? 8 : 3;
  ctx.shadowOffsetY = isLatest ? 0 : 2;
  ctx.fillStyle = withAlpha(felt, 0.92);
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = isLatest ? gold : withAlpha(gold, 0.38);
  ctx.lineWidth = isLatest ? 1.75 : 1;
  roundRect(ctx, x, y, w, h, 8);
  ctx.stroke();

  // Mini dice.
  const dieSize = Math.min(20, h * 0.42);
  const diceGap = 4;
  const diceY = y + 6;
  const diceX1 = x + w / 2 - dieSize - diceGap / 2;
  const diceX2 = x + w / 2 + diceGap / 2;
  drawDieFace(ctx, diceX1, diceY, dieSize, entry.d1, colors);
  drawDieFace(ctx, diceX2, diceY, dieSize, entry.d2, colors);

  // Total. Centered in the gap between the dice bottom and the outcome badge.
  // 14px keeps it clear of both (dice end at y+26, badge starts at y+44).
  ctx.save();
  ctx.font = "bold 14px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = colors.textWhite || "#ffffff";
  ctx.fillText(String(entry.total), x + w / 2, y + 6 + dieSize + 9);
  ctx.restore();

  // Outcome badge.
  if (entry.kind && entry.kind !== "neutral") {
    const label = ({
      sevenOut: "SEVEN OUT",
      pointHit: "POINT HIT",
      pointSet: `POINT ${entry.point ?? ""}`.trim(),
      pass: "PASS",
      crap: "CRAPS",
      natural: "NATURAL",
    })[entry.kind] || "";

    if (label) {
      ctx.save();
      ctx.font = "bold 10px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const padX = 5;
      const tw = Math.min(w - 6, ctx.measureText(label).width + padX * 2);
      const bx = x + w / 2 - tw / 2;
      const by = y + h - 16;
      const bh = 14;
      roundRect(ctx, bx, by, tw, bh, bh / 2);
      ctx.fillStyle = badgeColor;
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, x + w / 2, by + bh / 2 + 1);
      ctx.restore();
    }
  }
}


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
  await Promise.all(Object.entries(userAvatars).map(async ([uid, url]) => {
    const img = await loadAvatarByUrl(url);
    if (img) out[uid] = img;
  }));
  return out;
}

function drawTableFrame(ctx, colors) {
  drawPanel(ctx, TABLE_X, TABLE_Y, TABLE_W, TABLE_H, colors);
}

async function drawCrapsTable(state, themeColors) {
  const colors = themeColors || DEFAULT_COLORS;
  const canvas = createCanvas(CANVAS_W, CANVAS_H);
  const ctx = canvas.getContext("2d");

  await drawBackground(ctx, CANVAS_W, CANVAS_H, colors);
  drawAtmosphere(ctx, CANVAS_W, CANVAS_H, colors);

  drawHeader(ctx, state, colors);

  drawTableFrame(ctx, colors);

  const disabled = disabledZones(state);
  for (const [key, zone] of Object.entries(ZONES)) {
    drawZone(ctx, zone, colors, { disabled: disabled.has(key) });
  }

  const avatars = await resolveAvatars(state.userAvatars || {});
  const userColors = state.userColors || {};
  const aggregated = aggregateBets(state.bets || []);

  // Chips ride along the bottom edge of each zone so they don't sit on top
  // of the label / payout text. The amount badge sticks out a touch below
  // the chip but stays inside the zone bounds.
  for (const [zoneKey, userMap] of Object.entries(aggregated)) {
    const zone = ZONES[zoneKey];
    if (!zone) continue;
    const users = Object.entries(userMap);
    const N = users.length;
    const spacing = Math.min(48, Math.max(40, (zone.w - 30) / Math.max(N, 1)));
    const totalW = (N - 1) * spacing;
    const startX = zone.x + zone.w / 2 - totalW / 2;
    const cy = zone.y + zone.h - 22;
    for (let i = 0; i < N; i++) {
      const [uid, info] = users[i];
      const cx = startX + i * spacing;
      drawChipStack(ctx, cx, cy, info.amount, avatars[uid] || null, userColors[uid] || "#ffd700");
    }
  }

  drawRollHistory(ctx, state, colors);

  drawShooterSpotlight(ctx, state, avatars, colors);
  drawPlayerRoster(ctx, state, avatars, colors);

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
  const MARGIN_X = 24;
  const TITLE_Y = 56;

  const explTop = 96;
  const explLineH = 18;
  const explPadY = 14;
  const explH = explLineH * EXPLANATION_LINES.length + explPadY * 2;

  const rowH = 56;
  const rowGap = 8;
  const rowsTop = explTop + explH + 18;
  const totalRowsH = PAYTABLE_ENTRIES.length * (rowH + rowGap);
  const rulesTop = rowsTop + totalRowsH + 8;
  const rulesH = 92;
  const PT_H = rulesTop + rulesH + MARGIN_X;

  const canvas = createCanvas(PT_W, PT_H);
  const ctx = canvas.getContext("2d");

  await drawBackground(ctx, PT_W, PT_H, c);
  drawAtmosphere(ctx, PT_W, PT_H, c);

  drawTitle(ctx, PT_W / 2, TITLE_Y, "CRAPS PAYTABLE", c.gold || "#ffd700", c, { size: 34 });

  const sideX = MARGIN_X;
  const sideW = PT_W - MARGIN_X * 2;

  // Explanation panel
  drawPanel(ctx, sideX, explTop, sideW, explH, c);
  ctx.save();
  ctx.font = "13px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = c.textWhite || "#ffffff";
  for (let i = 0; i < EXPLANATION_LINES.length; i++) {
    const ly = explTop + explPadY + explLineH / 2 + i * explLineH;
    ctx.fillText(EXPLANATION_LINES[i], PT_W / 2, ly);
  }
  ctx.restore();

  // Bet rows
  for (let i = 0; i < PAYTABLE_ENTRIES.length; i++) {
    const e = PAYTABLE_ENTRIES[i];
    const ry = rowsTop + i * (rowH + rowGap);
    drawPanel(ctx, sideX, ry, sideW, rowH, c, { radius: 10 });

    ctx.save();
    ctx.font = "bold 17px Arial";
    ctx.fillStyle = c.textWhite || "#ffffff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(e.label, sideX + 16, ry + 19);

    ctx.font = "12px Arial";
    ctx.fillStyle = withAlpha(c.textWhite || "#ffffff", 0.65);
    ctx.fillText(e.note, sideX + 16, ry + 39);

    ctx.font = "bold 20px Arial";
    ctx.fillStyle = c.textWin || c.gold || "#ffd700";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(e.payout, sideX + sideW - 18, ry + rowH / 2);
    ctx.restore();
  }

  // Rules panel
  drawPanel(ctx, sideX, rulesTop, sideW, rulesH, c);
  ctx.save();
  ctx.font = "11px Arial";
  ctx.fillStyle = withAlpha(c.textWhite || "#ffffff", 0.7);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Multiple players can join the same session. Only the shooter can roll.", PT_W / 2, rulesTop + 20);
  ctx.fillText("Pass / Don't Pass: come-out only. Side bets: any time. Shooter rotates on a seven-out.", PT_W / 2, rulesTop + 38);
  ctx.fillText("The shooter can press Pass Dice to hand off the dice voluntarily at any time.", PT_W / 2, rulesTop + 56);
  ctx.fillStyle = withAlpha(c.textWhite || "#ffffff", 0.45);
  ctx.fillText("Simplified street craps — Come bets, Place bets, and Odds are not offered.", PT_W / 2, rulesTop + 74);
  ctx.restore();

  const buffer = canvas.toBuffer("image/png");
  return new AttachmentBuilder(buffer, { name: "craps-paytable.png" });
}

/**
 * Generate a craps preview PNG for the shop.
 * Features the user's avatar as the shooter when provided.
 */
async function crapsPreview(themeId, user = null, clientUser = null) {
  const colors = getThemeColors(themeId, "craps");
  const userAvatars = {};
  const userColors = {};
  const totals = {};
  const shooterOrder = [];

  if (user) {
    const uid = user.id || "user";
    shooterOrder.push(uid);
    userAvatars[uid] = user.displayAvatarURL ? user.displayAvatarURL({ extension: "png", size: 128 }) : null;
    userColors[uid] = colors.gold || "#ffd700";
    totals[uid] = { wagered: 0, won: 0, username: user.displayName || "You" };
  }
  if (clientUser) {
    const cid = clientUser.id || "bot";
    shooterOrder.push(cid);
    userAvatars[cid] = clientUser.displayAvatarURL ? clientUser.displayAvatarURL({ extension: "png", size: 128 }) : null;
    userColors[cid] = colors.textWhite || "#ffffff";
    totals[cid] = { wagered: 0, won: 0, username: clientUser.displayName || "Dealer" };
  }
  if (shooterOrder.length === 0) {
    shooterOrder.push("preview");
    userColors.preview = colors.gold || "#ffd700";
    totals.preview = { wagered: 0, won: 0, username: "Preview Shooter" };
  }

  const previewState = {
    phase: "point",
    point: 6,
    bets: [],
    shooterOrder,
    shooterId: shooterOrder[0],
    shooterUsername: totals[shooterOrder[0]].username,
    userAvatars,
    userColors,
    totals,
    lastRoll: { d1: 4, d2: 2, total: 6, isHard: false },
    rollHistory: [
      { d1: 3, d2: 4, total: 7, kind: "natural" },
      { d1: 5, d2: 1, total: 6, kind: "pointSet", point: 6 },
      { d1: 4, d2: 2, total: 6, kind: "pointHit" },
    ],
  };
  return drawCrapsTable(previewState, colors);
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
