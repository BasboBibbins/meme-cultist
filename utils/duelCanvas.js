const { createCanvas, loadImage } = require("canvas");
const { AttachmentBuilder } = require("discord.js");


function withAlpha(color, a) {
    if (!color || typeof color !== "string") return `rgba(0,0,0,${a})`;
    const trimmed = color.trim();
    // Themed feltColors are stored as `rgb(r, g, b, a)` / `rgba(...)` strings;
    // extract the channels and substitute our alpha.
    const m = trimmed.match(/^rgba?\s*\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)/i);
    if (m) return `rgba(${m[1]},${m[2]},${m[3]},${a})`;
    let h = trimmed.replace("#", "");
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    if (h.length !== 6) return `rgba(0,0,0,${a})`;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(0,0,0,${a})`;
    return `rgba(${r},${g},${b},${a})`;
}

let noiseTileCache = null;
function getNoiseTile() {
    if (noiseTileCache) return noiseTileCache;
    const size = 64;
    const c = createCanvas(size, size);
    const cctx = c.getContext("2d");
    const img = cctx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
        // Low-contrast grayscale grain centered around mid-gray; final tile is
        // drawn at low globalAlpha so only the variance reads.
        const v = 110 + ((Math.random() * 36) | 0);
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = 255;
    }
    cctx.putImageData(img, 0, 0);
    noiseTileCache = c;
    return c;
}

const spriteCache = new Map();
function loadSprite(p) {
    if (!p) return Promise.resolve(null);
    if (spriteCache.has(p)) return spriteCache.get(p);
    const promise = loadImage(p).catch(() => null);
    spriteCache.set(p, promise);
    return promise;
}

const bgCache = new Map();
function loadBackground(p) {
    if (!p) return Promise.resolve(null);
    if (bgCache.has(p)) return bgCache.get(p);
    const promise = loadImage(p).catch(() => null);
    bgCache.set(p, promise);
    return promise;
}

async function drawBackground(ctx, width, height, colors) {
    const felt = colors.feltColor || "#0f4c25";
    const bg = await loadBackground(colors.background);

    if (bg) {
        // Cover-fit the image to the canvas while preserving aspect.
        const scale = Math.max(width / bg.width, height / bg.height);
        const dw = bg.width * scale;
        const dh = bg.height * scale;
        ctx.drawImage(bg, (width - dw) / 2, (height - dh) / 2, dw, dh);
        // Felt tint over the bg keeps the table readable. Themed feltColor
        // tokens carry baked-in alpha so the bg shows through.
        ctx.fillStyle = felt;
        ctx.fillRect(0, 0, width, height);
        return;
    }

    // No image: solid felt base + tableGreen→felt radial fade.
    ctx.fillStyle = felt;
    ctx.fillRect(0, 0, width, height);
    const grad = ctx.createRadialGradient(width / 2, height / 2, 50, width / 2, height / 2, 400);
    grad.addColorStop(0, colors.tableGreen || "#1a6b35");
    grad.addColorStop(1, felt);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
}

const AVATAR_SIZE = 100;
const AVATAR_Y = 100;
const PANEL_LEFT_X = 60;
const PANEL_RIGHT_X = 800 - 60;

function avatarCenter(side) {
    const cx = side === "left"
        ? PANEL_LEFT_X + AVATAR_SIZE / 2
        : PANEL_RIGHT_X - AVATAR_SIZE / 2;
    return { x: cx, y: AVATAR_Y + AVATAR_SIZE / 2 };
}

function drawWinnerBackdrop(ctx, side, colors) {
    const { x, y } = avatarCenter(side);
    const accent = colors.textWin || "#44ff44";

    // Large radial glow behind the avatar.
    ctx.save();
    const glow = ctx.createRadialGradient(x, y, 10, x, y, 180);
    glow.addColorStop(0, withAlpha(accent, 0.45));
    glow.addColorStop(0.55, withAlpha(accent, 0.18));
    glow.addColorStop(1, withAlpha(accent, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(x - 200, y - 200, 400, 400);
    ctx.restore();

    // Double ring around the avatar position.
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = withAlpha(accent, 0.85);
    ctx.beginPath();
    ctx.arc(x, y, AVATAR_SIZE / 2 + 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = withAlpha(accent, 0.45);
    ctx.beginPath();
    ctx.arc(x, y, AVATAR_SIZE / 2 + 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

function applyLoserTreatment(ctx, side, width, height, colors) {
    // Desaturate the loser half via luminance-blend pixel loop. node-canvas
    // does not support ctx.filter reliably and the "saturation" composite
    // mode has historically been buggy.
    const halfX = side === "left" ? 0 : Math.floor(width / 2);
    const halfW = Math.floor(width / 2);
    const img = ctx.getImageData(halfX, 0, halfW, height);
    const d = img.data;
    const mix = 0.7;
    for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        d[i]     = r + (gray - r) * mix;
        d[i + 1] = g + (gray - g) * mix;
        d[i + 2] = b + (gray - b) * mix;
    }
    ctx.putImageData(img, halfX, 0);

    // Dim overlay on the loser half.
    ctx.save();
    ctx.fillStyle = withAlpha(colors.feltColor || "#0f4c25", 0.32);
    ctx.fillRect(halfX, 0, halfW, height);
    ctx.restore();
}

function drawAsymmetrySprites(ctx, winnerSide, loserSide, sprites) {
    const wc = avatarCenter(winnerSide);
    const lc = avatarCenter(loserSide);

    if (sprites.crown) {
        const w = 56, h = 56;
        ctx.drawImage(sprites.crown, wc.x - w / 2, AVATAR_Y - h + 6, w, h);
    }
    if (sprites.fracture) {
        const w = 90, h = 90;
        ctx.drawImage(sprites.fracture, lc.x - w / 2, lc.y - h / 2, w, h);
    }
}

function drawWinnerBanner(ctx, x, y, text, accent, maxWidth, colors) {
    const felt = colors.feltColor || "#0f4c25";
    ctx.save();
    let fontSize = 56;
    ctx.font = `bold ${fontSize}px sans-serif`;
    const measured = ctx.measureText(text).width;
    if (measured > maxWidth) {
        fontSize = Math.max(18, Math.floor(fontSize * maxWidth / measured));
        ctx.font = `bold ${fontSize}px sans-serif`;
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = withAlpha(accent, 0.85);
    ctx.shadowBlur = 24;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.lineWidth = 5;
    ctx.strokeStyle = felt;
    ctx.strokeText(text, x, y);
    ctx.shadowBlur = 0;
    ctx.fillStyle = accent;
    ctx.fillText(text, x, y);
    ctx.restore();
}

function drawPotBlock(ctx, x, y, bet, coinSprite, colors) {
    const gold = colors.gold || "#ffd700";
    const felt = colors.feltColor || "#0f4c25";
    const pot = bet * 2 // add both users' bets to pot
    const amountText = pot.toLocaleString("en-US");

    ctx.save();
    ctx.font = "bold 26px 'DejaVu Sans Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const textWidth = ctx.measureText(amountText).width;

    // Faint silhouettes scattered behind the digits.
    if (coinSprite) {
        ctx.save();
        ctx.globalAlpha = 0.14;
        const spread = textWidth / 2 + 50;
        const scatter = [
            { dx: -spread,       dy: -6, s: 22 },
            { dx: -spread / 2,   dy:  8, s: 18 },
            { dx:  0,            dy: -12, s: 20 },
            { dx:  spread / 2,   dy:  8, s: 18 },
            { dx:  spread,       dy: -6, s: 22 },
        ];
        for (const c of scatter) {
            ctx.drawImage(coinSprite, x + c.dx - c.s / 2, y + c.dy - c.s / 2, c.s, c.s);
        }
        ctx.restore();
    }

    // Flanking coin sprites, full opacity.
    if (coinSprite) {
        const size = 28;
        const pad = 12;
        ctx.drawImage(coinSprite, x - textWidth / 2 - pad - size, y - size / 2, size, size);
        ctx.drawImage(coinSprite, x + textWidth / 2 + pad,        y - size / 2, size, size);
    }

    // Inner-shadow digits: dark offset under, gold on top.
    ctx.fillStyle = felt;
    ctx.fillText(amountText, x + 1, y + 1);
    ctx.fillStyle = gold;
    ctx.fillText(amountText, x, y);
    ctx.restore();
}

function drawCenterClash(ctx, width, height, colors) {
    const cx = width / 2;
    const vsY = height / 2 - 20;
    const gold = colors.gold || "#ffd700";
    const dividerTop = 40;
    const dividerBot = height - 40;

    // Tapered divider: alpha-fade gradient along the stroke so the line
    // appears thicker/brighter in the middle and dissolves toward the ends.
    ctx.save();
    const grad = ctx.createLinearGradient(0, dividerTop, 0, dividerBot);
    grad.addColorStop(0, withAlpha(gold, 0));
    grad.addColorStop(0.18, withAlpha(gold, 0.85));
    grad.addColorStop(0.5, gold);
    grad.addColorStop(0.82, withAlpha(gold, 0.85));
    grad.addColorStop(1, withAlpha(gold, 0));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, dividerTop);
    ctx.lineTo(cx, dividerBot);
    ctx.stroke();
    ctx.restore();

    // Diamond ornaments at the divider ends.
    ctx.save();
    ctx.fillStyle = gold;
    for (const y of [dividerTop, dividerBot]) {
        ctx.beginPath();
        ctx.moveTo(cx, y - 6);
        ctx.lineTo(cx + 5, y);
        ctx.lineTo(cx, y + 6);
        ctx.lineTo(cx - 5, y);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();

    // Impact burst: 12 radial rays behind the VS text.
    ctx.save();
    ctx.translate(cx, vsY);
    ctx.strokeStyle = withAlpha(gold, 0.28);
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    const rays = 12;
    for (let i = 0; i < rays; i++) {
        const ang = (i / rays) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * 34, Math.sin(ang) * 34);
        ctx.lineTo(Math.cos(ang) * 92, Math.sin(ang) * 92);
        ctx.stroke();
    }
    ctx.restore();
}

function drawVS(ctx, width, height, colors) {
    const cx = width / 2;
    const cy = height / 2 - 20;
    const gold = colors.gold || "#ffd700";
    const felt = colors.feltColor || "#0f4c25";
    ctx.save();
    ctx.font = "bold 56px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = withAlpha(gold, 0.9);
    ctx.shadowBlur = 18;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.lineWidth = 4;
    ctx.strokeStyle = felt;
    ctx.strokeText("VS", cx, cy);
    ctx.shadowBlur = 0;
    ctx.fillStyle = gold;
    ctx.fillText("VS", cx, cy);
    ctx.restore();
}

function drawMotionStreaks(ctx, iconCX, iconCY, align, colors) {
    const gold = colors.gold || "#ffd700";
    // Streaks trail the icon outward (away from the center clash),
    // reading as the icon thrust inward toward the VS.
    const dir = align === "left" ? -1 : 1;
    const startX = iconCX + dir * 36;
    ctx.save();
    ctx.strokeStyle = withAlpha(gold, 0.42);
    ctx.lineCap = "round";
    const streaks = [
        { off: -14, len: 36, w: 2 },
        { off:   0, len: 52, w: 3 },
        { off:  14, len: 36, w: 2 },
        { off:  -7, len: 24, w: 1.5 },
        { off:   7, len: 24, w: 1.5 },
    ];
    for (const s of streaks) {
        ctx.lineWidth = s.w;
        ctx.beginPath();
        ctx.moveTo(startX, iconCY + s.off);
        ctx.lineTo(startX + dir * s.len, iconCY + s.off);
        ctx.stroke();
    }
    ctx.restore();
}

function drawAtmosphere(ctx, width, height, colors) {
    // Vignette: transparent at canvas center, dark feltColor at corners.
    ctx.save();
    const vg = ctx.createRadialGradient(
        width / 2, height / 2, Math.min(width, height) * 0.3,
        width / 2, height / 2, Math.max(width, height) * 0.65,
    );
    vg.addColorStop(0, withAlpha(colors.feltColor || "#0f4c25", 0));
    vg.addColorStop(1, withAlpha(colors.feltColor || "#0f4c25", 0.55));
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    // Tiled noise grain across the felt.
    ctx.save();
    const tile = getNoiseTile();
    const pattern = ctx.createPattern(tile, "repeat");
    if (pattern) {
        ctx.globalAlpha = 0.04;
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, width, height);
    }
    ctx.restore();

    // Corner brackets framing the canvas.
    ctx.save();
    ctx.strokeStyle = withAlpha(colors.gold || "#ffd700", 0.55);
    ctx.lineWidth = 3;
    ctx.lineCap = "square";
    const inset = 18;
    const len = 32;
    const corners = [
        { x: inset, y: inset, dx: 1, dy: 1 },
        { x: width - inset, y: inset, dx: -1, dy: 1 },
        { x: inset, y: height - inset, dx: 1, dy: -1 },
        { x: width - inset, y: height - inset, dx: -1, dy: -1 },
    ];
    for (const c of corners) {
        ctx.beginPath();
        ctx.moveTo(c.x + c.dx * len, c.y);
        ctx.lineTo(c.x, c.y);
        ctx.lineTo(c.x, c.y + c.dy * len);
        ctx.stroke();
    }
    ctx.restore();
}

// Cache decoded avatars across the four-phase duel lifecycle (challenge, choose,
// result, rematch). Without this, every phase re-fetched both avatars — up to 8
// fetches per duel against Discord's CDN.
const avatarCache = new Map();
function loadUserAvatar(user) {
    if (!user) return Promise.resolve(null);
    const url = user.displayAvatarURL({ extension: "png", size: 128 });
    if (avatarCache.has(url)) return avatarCache.get(url);
    const promise = (async () => {
        try {
            const res = await fetch(url);
            if (!res.ok) return null;
            const buf = Buffer.from(await res.arrayBuffer());
            return await loadImage(buf);
        } catch {
            return null;
        }
    })();
    avatarCache.set(url, promise);
    return promise;
}

async function renderDuel({ challenger, opponent, bet, challengerChoice, opponentChoice, result, colors }) {
    const width = 800;
    const height = 400;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    await drawBackground(ctx, width, height, colors);

    drawAtmosphere(ctx, width, height, colors);

    drawCenterClash(ctx, width, height, colors);
    drawVS(ctx, width, height, colors);

    const bannerY = 42;
    const potY = height - 30;

    // Pre-fetch both avatars and sprites in parallel.
    const [challengerAvatar, opponentAvatar, coinSprite, rockSprite, paperSprite, scissorsSprite] = await Promise.all([
        loadUserAvatar(challenger),
        loadUserAvatar(opponent),
        loadSprite(colors.coinSprite),
        loadSprite(colors.rockSprite),
        loadSprite(colors.paperSprite),
        loadSprite(colors.scissorsSprite),
    ]);
    const choiceSprites = { rock: rockSprite, paper: paperSprite, scissors: scissorsSprite };

    const winnerSide = result === "challenger" ? "left"
        : result === "opponent" ? "right"
        : null;
    const loserSide = winnerSide === "left" ? "right"
        : winnerSide === "right" ? "left"
        : null;

    if (winnerSide) {
        drawWinnerBackdrop(ctx, winnerSide, colors);
    }

    // Helper to draw a player panel
    async function drawPlayerPanel(user, choice, x, align, avatarImg) {
        const avatarSize = AVATAR_SIZE;
        const avatarX = align === "left" ? x : x - avatarSize;
        const avatarY = AVATAR_Y;

        // Avatar circle background
        ctx.beginPath();
        ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 4, 0, Math.PI * 2);
        ctx.fillStyle = colors.gold || "#ffd700";
        ctx.fill();

        // Draw avatar
        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        if (avatarImg) {
            ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
        } else {
            ctx.fillStyle = colors.feltDark || "#0a3a1a";
            ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
        }
        ctx.restore();

        // Name
        ctx.font = "bold 22px sans-serif";
        ctx.fillStyle = colors.textWhite || "#ffffff";
        ctx.textAlign = align;
        ctx.textBaseline = "top";
        const nameX = align === "left" ? x + avatarSize / 2 : x - avatarSize / 2;
        ctx.fillText(user.displayName, nameX, avatarY + avatarSize + 12);

        // Wager (with leading coin prefix)
        ctx.font = "18px sans-serif";
        const wagerText = `${bet.toLocaleString("en-US")} koku`;
        const wagerY = avatarY + avatarSize + 40;
        const coinSize = 16;
        const gap = 4;
        const wagerTextWidth = ctx.measureText(wagerText).width;
        const totalWagerWidth = coinSize + gap + wagerTextWidth;
        const wagerStartX = align === "left" ? nameX : nameX - totalWagerWidth;
        if (coinSprite) {
            ctx.drawImage(coinSprite, wagerStartX, wagerY + 1, coinSize, coinSize);
        }
        ctx.save();
        ctx.textAlign = "left";
        ctx.fillStyle = colors.gold || "#ffd700";
        ctx.fillText(wagerText, wagerStartX + coinSize + gap, wagerY);
        ctx.restore();

        // Choice icon circle
        const iconSize = 60;
        const iconX = align === "left" ? x + avatarSize / 2 - iconSize / 2 : x - avatarSize / 2 - iconSize / 2;
        const iconY = avatarY + avatarSize + 75;
        const iconCX = iconX + iconSize / 2;
        const iconCY = iconY + iconSize / 2;

        if (choice) {
            drawMotionStreaks(ctx, iconCX, iconCY, align, colors);
        }

        ctx.beginPath();
        ctx.arc(iconCX, iconCY, iconSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = colors.feltDark || "#0a3a1a";
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = colors.gold || "#ffd700";
        ctx.stroke();

        // Choice sprite (mirrored for the right-side player so the icon
        // faces inward toward the opponent).
        const sprite = choiceSprites[choice];
        if (sprite) {
            const drawSize = 44;
            ctx.save();
            if (align === "right") {
                ctx.translate(iconCX, iconCY);
                ctx.scale(-1, 1);
                ctx.drawImage(sprite, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
            } else {
                ctx.drawImage(sprite, iconCX - drawSize / 2, iconCY - drawSize / 2, drawSize, drawSize);
            }
            ctx.restore();
        } else {
            ctx.font = "32px sans-serif";
            ctx.fillStyle = colors.textWhite || "#ffffff";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("?", iconCX, iconCY);
        }
    }

    await drawPlayerPanel(challenger, challengerChoice, 60, "left", challengerAvatar);
    await drawPlayerPanel(opponent, opponentChoice, width - 60, "right", opponentAvatar);

    if (winnerSide) {
        applyLoserTreatment(ctx, loserSide, width, height, colors);
        const [crown, fracture] = await Promise.all([
            loadSprite(colors.crownSprite),
            loadSprite(colors.fractureSprite),
        ]);
        drawAsymmetrySprites(ctx, winnerSide, loserSide, { crown, fracture });
    }

    drawPotBlock(ctx, width / 2, potY, bet, coinSprite, colors);

    let bannerText, bannerAccent;
    if (result == null) {
        bannerText = "Choose Your Weapon!";
        bannerAccent = colors.gold || "#ffd700";
    } else if (result === "draw") {
        bannerText = "DRAW!";
        bannerAccent = colors.textWhite || "#ffffff";
    } else if (result === "challenger") {
        bannerText = `${challenger.displayName} Wins!`;
        bannerAccent = colors.textWin || "#44ff44";
    } else {
        bannerText = `${opponent.displayName} Wins!`;
        bannerAccent = colors.textWin || "#44ff44";
    }
    drawWinnerBanner(ctx, width / 2, bannerY, bannerText, bannerAccent, (width * 2) / 3, colors);

    const buffer = canvas.toBuffer("image/png");
    return new AttachmentBuilder(buffer, { name: "duel.png" });
}

module.exports = { renderDuel };
