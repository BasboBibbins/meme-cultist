const { createCanvas } = require("canvas");
const { AttachmentBuilder } = require("discord.js");
const { getThemeColors } = require("../themes/resolver");
const {
  roundRect,
  drawBackground,
  drawAtmosphere,
  drawTitle,
  drawPanel,
  drawPanelHeading,
} = require("./canvasCommon");
const {
  KENO_TOTAL_NUMBERS,
  KENO_DRAW_COUNT,
  KENO_MAX_SPOTS,
  PAYTABLE,
  matchProbability,
  expectedReturn,
} = require("./keno");

const DEFAULT_COLORS = getThemeColors("classic", "keno");

const CANVAS_W = 900;
const CANVAS_H = 520;

const GRID_COLS = 10;
const GRID_ROWS = 8;
const CELL = 44;
const CELL_GAP = 4;

const GRID_PANEL_X = 24;
const GRID_PANEL_Y = 64;
const GRID_PANEL_W = GRID_COLS * CELL + (GRID_COLS - 1) * CELL_GAP + 24;
const GRID_PANEL_H = GRID_ROWS * CELL + (GRID_ROWS - 1) * CELL_GAP + 40;
const GRID_X = GRID_PANEL_X + 12;
const GRID_Y = GRID_PANEL_Y + 34;

const SIDE_X = GRID_PANEL_X + GRID_PANEL_W + 16;
const SIDE_W = CANVAS_W - SIDE_X - 24;

function cellPosition(number) {
  const index = number - 1;
  const row = Math.floor(index / GRID_COLS);
  const col = index % GRID_COLS;
  return {
    x: GRID_X + col * (CELL + CELL_GAP),
    y: GRID_Y + row * (CELL + CELL_GAP),
  };
}

function formatMultiplier(value) {
  if (!value) return "—";
  const rounded = Number.isInteger(value) ? value.toLocaleString("en-US") : value.toFixed(1);
  return `${rounded}x`;
}

function formatOdds(probability) {
  if (probability <= 0) return "—";
  const one_in = 1 / probability;
  if (one_in >= 1000) return `1 in ${Math.round(one_in).toLocaleString("en-US")}`;
  return `1 in ${one_in.toFixed(1)}`;
}

// Drawn, not typed — node-canvas's Arial renders ★/✓ as tofu.
function drawTick(ctx, x, y, size, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, size * 0.18);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x + size * 0.08, y + size * 0.5);
  ctx.lineTo(x + size * 0.38, y + size * 0.8);
  ctx.lineTo(x + size * 0.92, y + size * 0.15);
  ctx.stroke();
  ctx.restore();
}

// Fill marks drawn, border weight marks picked, tick marks a hit — a theme can
// land all three colors close together, so none of them carries a state alone.
function drawCell(ctx, number, state, colors) {
  const { x, y } = cellPosition(number);
  const picked = state === "picked" || state === "hit";

  ctx.fillStyle = state === "hit" ? colors.hitFill : state === "drawn" ? colors.drawnFill : colors.cellBg;
  roundRect(ctx, x, y, CELL, CELL, 7);
  ctx.fill();

  ctx.strokeStyle = picked ? colors.pickedBorder : colors.cellBorder;
  ctx.lineWidth = picked ? 3 : 1;
  roundRect(ctx, x, y, CELL, CELL, 7);
  ctx.stroke();

  ctx.fillStyle = state === "hit" ? colors.hitText
    : state === "drawn" ? colors.drawnText
      : picked ? colors.pickedText : colors.cellText;
  ctx.font = picked ? "bold 17px Arial" : "16px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(number), x + CELL / 2, y + CELL / 2 + 1);

  if (state === "hit") {
    drawTick(ctx, x + CELL - 16, y + CELL - 15, 12, colors.hitGlyph);
  }
}

function drawGrid(ctx, spots, drawn, colors) {
  drawPanel(ctx, GRID_PANEL_X, GRID_PANEL_Y, GRID_PANEL_W, GRID_PANEL_H, colors);
  drawPanelHeading(ctx, GRID_PANEL_X, GRID_PANEL_Y, GRID_PANEL_W, `BOARD — ${KENO_DRAW_COUNT} DRAWN`, colors);

  const spotSet = new Set(spots);
  const drawnSet = new Set(drawn);

  for (let n = 1; n <= KENO_TOTAL_NUMBERS; n++) {
    const isSpot = spotSet.has(n);
    const isDrawn = drawnSet.has(n);
    const state = isSpot && isDrawn ? "hit" : isSpot ? "picked" : isDrawn ? "drawn" : "empty";
    drawCell(ctx, n, state, colors);
  }
}

function drawLegend(ctx, colors) {
  const y = GRID_PANEL_Y + GRID_PANEL_H + 18;
  const entries = [
    { label: "Your pick", state: "picked" },
    { label: "Drawn", state: "drawn" },
    { label: "Hit", state: "hit" },
  ];

  let x = GRID_PANEL_X + 4;
  for (const entry of entries) {
    const size = 18;
    ctx.fillStyle = entry.state === "hit" ? colors.hitFill : entry.state === "drawn" ? colors.drawnFill : colors.cellBg;
    roundRect(ctx, x, y - size / 2, size, size, 4);
    ctx.fill();
    ctx.strokeStyle = entry.state === "picked" || entry.state === "hit" ? colors.pickedBorder : colors.cellBorder;
    ctx.lineWidth = entry.state === "picked" || entry.state === "hit" ? 2.5 : 1;
    roundRect(ctx, x, y - size / 2, size, size, 4);
    ctx.stroke();

    if (entry.state === "hit") {
      drawTick(ctx, x + 3, y - size / 2 + 4, 12, colors.hitGlyph);
    }

    ctx.fillStyle = colors.cellText;
    ctx.font = "13px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(entry.label, x + size + 8, y + 1);
    x += size + 12 + ctx.measureText(entry.label).width + 22;
  }
}

function drawStatLine(ctx, x, y, label, value, colors, valueColor) {
  ctx.font = "13px Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = colors.cellText;
  ctx.globalAlpha = 0.75;
  ctx.fillText(label, x, y);
  ctx.globalAlpha = 1;

  ctx.font = "bold 15px Arial";
  ctx.textAlign = "right";
  ctx.fillStyle = valueColor || colors.cellText;
  ctx.fillText(value, x + SIDE_W - 28, y);
}

function drawSidePanel(ctx, state, colors) {
  const { spots, matched, matches, bet, multiplier, payout, net, balance, currencyName } = state;

  drawPanel(ctx, SIDE_X, GRID_PANEL_Y, SIDE_W, GRID_PANEL_H, colors, { accent: true });
  drawPanelHeading(ctx, SIDE_X, GRID_PANEL_Y, SIDE_W, "RESULT", colors);

  const x = SIDE_X + 14;
  let y = GRID_PANEL_Y + 52;
  const step = 26;

  drawStatLine(ctx, x, y, "Spots played", String(spots.length), colors);
  y += step;
  drawStatLine(ctx, x, y, "Matches", `${matches} of ${spots.length}`, colors, matches > 0 ? colors.headerAccent : undefined);
  y += step;
  drawStatLine(ctx, x, y, "Multiplier", formatMultiplier(multiplier), colors, multiplier > 0 ? colors.headerAccent : undefined);
  y += step + 6;

  ctx.strokeStyle = colors.cellBorder;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y - 10);
  ctx.lineTo(SIDE_X + SIDE_W - 14, y - 10);
  ctx.stroke();
  ctx.globalAlpha = 1;

  drawStatLine(ctx, x, y, "Bet", bet.toLocaleString("en-US"), colors);
  y += step;
  drawStatLine(ctx, x, y, "Returned", payout.toLocaleString("en-US"), colors);
  y += step;
  const netColor = net > 0 ? colors.textWin : net < 0 ? colors.textLoss : colors.cellText;
  drawStatLine(ctx, x, y, `Net (${currencyName})`, `${net > 0 ? "+" : ""}${net.toLocaleString("en-US")}`, colors, netColor);
  y += step;
  if (typeof balance === "number") {
    drawStatLine(ctx, x, y, "Balance", balance.toLocaleString("en-US"), colors);
    y += step;
  }

  y += 10;
  ctx.font = "bold 12px Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = colors.headerAccent;
  ctx.fillText("YOUR PICKS", x, y);
  y += 20;

  const matchedSet = new Set(matched);
  const perRow = 5;
  const chipW = (SIDE_W - 28 - (perRow - 1) * 6) / perRow;
  spots.forEach((number, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const cx = x + col * (chipW + 6);
    const cy = y + row * 30;
    const isHit = matchedSet.has(number);

    ctx.fillStyle = isHit ? colors.hitFill : colors.cellBg;
    roundRect(ctx, cx, cy, chipW, 24, 5);
    ctx.fill();
    ctx.strokeStyle = isHit ? colors.pickedBorder : colors.cellBorder;
    ctx.lineWidth = isHit ? 2 : 1;
    roundRect(ctx, cx, cy, chipW, 24, 5);
    ctx.stroke();

    ctx.fillStyle = isHit ? colors.hitText : colors.cellText;
    ctx.font = isHit ? "bold 14px Arial" : "14px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(number), cx + chipW / 2, cy + 13);
  });
}

async function drawKenoResult(state, colors = DEFAULT_COLORS) {
  const canvas = createCanvas(CANVAS_W, CANVAS_H);
  const ctx = canvas.getContext("2d");

  await drawBackground(ctx, CANVAS_W, CANVAS_H, colors);
  drawAtmosphere(ctx, CANVAS_W, CANVAS_H, colors);
  drawTitle(ctx, CANVAS_W / 2, 34, "KENO", colors.headerAccent, colors, { size: 34 });

  drawGrid(ctx, state.spots, state.drawn, colors);
  drawSidePanel(ctx, { currencyName: "koku", ...state }, colors);
  drawLegend(ctx, colors);

  return new AttachmentBuilder(canvas.toBuffer("image/png")).setName("keno.png");
}

function drawSingleSpotTable(ctx, spots, colors) {
  const row = PAYTABLE[spots];
  const panelW = 520;
  const panelX = (CANVAS_W - panelW) / 2;
  const rowH = 30;
  const panelH = 60 + (spots + 1) * rowH + 34;
  const panelY = 64 + Math.max(0, (CANVAS_H - 84 - panelH) / 2);

  drawPanel(ctx, panelX, panelY, panelW, panelH, colors, { accent: true });
  drawPanelHeading(ctx, panelX, panelY, panelW, `${spots} SPOT — PICK ${spots} OF ${KENO_TOTAL_NUMBERS}`, colors);

  const colMatch = panelX + 40;
  const colPays = panelX + 250;
  const colOdds = panelX + panelW - 40;
  let y = panelY + 54;

  ctx.font = "bold 13px Arial";
  ctx.textBaseline = "middle";
  ctx.fillStyle = colors.headerAccent;
  ctx.textAlign = "left";
  ctx.fillText("MATCHES", colMatch, y);
  ctx.textAlign = "right";
  ctx.fillText("PAYS", colPays, y);
  ctx.fillText("ODDS", colOdds, y);
  y += 24;

  for (let m = 0; m <= spots; m++) {
    const pays = row[m];
    const probability = matchProbability(spots, m);

    if (pays > 0) {
      ctx.fillStyle = colors.cellBg;
      roundRect(ctx, panelX + 20, y - rowH / 2 + 2, panelW - 40, rowH - 4, 6);
      ctx.fill();
      ctx.strokeStyle = colors.pickedBorder;
      ctx.lineWidth = 1;
      roundRect(ctx, panelX + 20, y - rowH / 2 + 2, panelW - 40, rowH - 4, 6);
      ctx.stroke();
    }

    ctx.font = pays > 0 ? "bold 15px Arial" : "15px Arial";
    ctx.fillStyle = pays > 0 ? colors.pickedText : colors.cellText;
    if (pays === 0) ctx.globalAlpha = 0.55;
    ctx.textAlign = "left";
    ctx.fillText(String(m), colMatch, y);
    ctx.textAlign = "right";
    ctx.fillText(formatMultiplier(pays), colPays, y);

    ctx.font = "13px Arial";
    ctx.fillStyle = colors.cellText;
    ctx.globalAlpha = pays > 0 ? 0.8 : 0.5;
    ctx.fillText(formatOdds(probability), colOdds, y);
    ctx.globalAlpha = 1;

    y += rowH;
  }

  ctx.font = "13px Arial";
  ctx.textAlign = "center";
  ctx.fillStyle = colors.headerAccent;
  ctx.fillText(
    `Return to player: ${(expectedReturn(spots) * 100).toFixed(1)}%  ·  payouts replace your stake`,
    panelX + panelW / 2,
    panelY + panelH - 22,
  );
}

function drawOverviewTable(ctx, colors) {
  const labelW = 62;
  const cellW = 62;
  const rtpW = 74;
  const panelW = labelW + cellW * (KENO_MAX_SPOTS + 1) + rtpW + 28;
  const panelX = (CANVAS_W - panelW) / 2;
  const panelY = 64;
  const rowH = 33;
  const panelH = 54 + (KENO_MAX_SPOTS + 1) * rowH + 26;

  drawPanel(ctx, panelX, panelY, panelW, panelH, colors, { accent: true });
  drawPanelHeading(ctx, panelX, panelY, panelW, "PAYOUT MULTIPLIERS BY MATCH COUNT", colors);

  const gridX = panelX + 14 + labelW;
  let y = panelY + 50;

  ctx.font = "bold 12px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = colors.headerAccent;
  ctx.fillText("SPOTS", panelX + 14 + labelW / 2, y);
  for (let m = 0; m <= KENO_MAX_SPOTS; m++) {
    ctx.fillText(String(m), gridX + m * cellW + cellW / 2, y);
  }
  ctx.fillText("RTP", gridX + (KENO_MAX_SPOTS + 1) * cellW + rtpW / 2, y);
  y += 26;

  for (let spots = 1; spots <= KENO_MAX_SPOTS; spots++) {
    ctx.font = "bold 14px Arial";
    ctx.fillStyle = colors.pickedText;
    ctx.textAlign = "center";
    ctx.fillText(String(spots), panelX + 14 + labelW / 2, y);

    for (let m = 0; m <= KENO_MAX_SPOTS; m++) {
      if (m > spots) continue;
      const pays = PAYTABLE[spots][m];
      if (pays > 0) {
        ctx.fillStyle = colors.cellBg;
        roundRect(ctx, gridX + m * cellW + 2, y - 13, cellW - 4, 26, 5);
        ctx.fill();
        ctx.strokeStyle = colors.pickedBorder;
        ctx.lineWidth = 1;
        roundRect(ctx, gridX + m * cellW + 2, y - 13, cellW - 4, 26, 5);
        ctx.stroke();
      }
      ctx.font = pays > 0 ? "bold 12px Arial" : "12px Arial";
      ctx.fillStyle = pays > 0 ? colors.pickedText : colors.cellText;
      ctx.globalAlpha = pays > 0 ? 1 : 0.4;
      ctx.fillText(formatMultiplier(pays), gridX + m * cellW + cellW / 2, y);
      ctx.globalAlpha = 1;
    }

    ctx.font = "12px Arial";
    ctx.fillStyle = colors.cellText;
    ctx.globalAlpha = 0.85;
    ctx.fillText(`${(expectedReturn(spots) * 100).toFixed(1)}%`, gridX + (KENO_MAX_SPOTS + 1) * cellW + rtpW / 2, y);
    ctx.globalAlpha = 1;

    y += rowH;
  }

  ctx.font = "13px Arial";
  ctx.textAlign = "center";
  ctx.fillStyle = colors.headerAccent;
  ctx.fillText(
    `${KENO_DRAW_COUNT} of ${KENO_TOTAL_NUMBERS} numbers are drawn · a payout replaces your stake, so 1x is your money back`,
    CANVAS_W / 2,
    panelY + panelH - 16,
  );
}

async function drawPaytable(colors = DEFAULT_COLORS, opts = {}) {
  const canvas = createCanvas(CANVAS_W, CANVAS_H);
  const ctx = canvas.getContext("2d");

  await drawBackground(ctx, CANVAS_W, CANVAS_H, colors);
  drawAtmosphere(ctx, CANVAS_W, CANVAS_H, colors);
  drawTitle(ctx, CANVAS_W / 2, 34, "KENO PAYTABLE", colors.headerAccent, colors, { size: 30 });

  if (opts.spots && PAYTABLE[opts.spots]) {
    drawSingleSpotTable(ctx, opts.spots, colors);
  } else {
    drawOverviewTable(ctx, colors);
  }

  return new AttachmentBuilder(canvas.toBuffer("image/png")).setName("keno-paytable.png");
}

function kenoPreview(themeId) {
  const colors = getThemeColors(themeId, "keno");
  return drawKenoResult({
    spots: [4, 11, 23, 37, 42, 58, 66, 79],
    drawn: [2, 4, 9, 11, 17, 23, 25, 31, 37, 40, 44, 49, 53, 58, 61, 63, 66, 70, 74, 79],
    matched: [4, 11, 23, 37, 58, 66, 79],
    matches: 7,
    bet: 5000,
    multiplier: 850,
    payout: 4250000,
    net: 4245000,
    balance: 4312500,
  }, colors);
}

module.exports = {
  drawKenoResult,
  drawPaytable,
  kenoPreview,
  CANVAS_W,
  CANVAS_H,
};
