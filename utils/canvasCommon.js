const { createCanvas, loadImage } = require("canvas");

// Shared canvas helpers for every game renderer. See docs/CANVAS-STYLE-GUIDE.md
// for which helpers are required and the visual contract they implement.

function withAlpha(color, a) {
    if (!color || typeof color !== "string") return `rgba(0,0,0,${a})`;
    const trimmed = color.trim();
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
function loadBackgroundImage(p) {
    if (!p) return Promise.resolve(null);
    if (bgCache.has(p)) return bgCache.get(p);
    const promise = loadImage(p).catch(() => null);
    bgCache.set(p, promise);
    return promise;
}

// Caches decoded avatars by URL across the full session. Critical for
// multi-phase games where the same user re-renders 3-8 times per game.
const avatarCache = new Map();
function loadUserAvatar(user) {
    if (!user) return Promise.resolve(null);
    const url = user.displayAvatarURL({ extension: "png", size: 128 });
    return loadAvatarByUrl(url);
}

function loadAvatarByUrl(url) {
    if (!url) return Promise.resolve(null);
    if (avatarCache.has(url)) return avatarCache.get(url);
    const promise = (async () => {
        try {
            // Local file paths (used in previews/tests) won't pass a URL parse.
            if (/^https?:\/\//i.test(url)) {
                const res = await fetch(url);
                if (!res.ok) return null;
                const buf = Buffer.from(await res.arrayBuffer());
                return await loadImage(buf);
            }
            return await loadImage(url);
        } catch {
            return null;
        }
    })();
    avatarCache.set(url, promise);
    return promise;
}

// Canonical background pass: cover-fit themed image, then tint the entire
// canvas with `feltColor`. Themed feltColor strings carry baked-in alpha so
// the image still shows through. Falls back to a tableGreen->feltColor radial
// gradient when no image is set.
async function drawBackground(ctx, width, height, colors) {
    const felt = colors.feltColor || "#0f4c25";
    const bg = await loadBackgroundImage(colors.background);

    if (bg) {
        const scale = Math.max(width / bg.width, height / bg.height);
        const dw = bg.width * scale;
        const dh = bg.height * scale;
        ctx.drawImage(bg, (width - dw) / 2, (height - dh) / 2, dw, dh);
        ctx.fillStyle = felt;
        ctx.fillRect(0, 0, width, height);
        return;
    }

    ctx.fillStyle = felt;
    ctx.fillRect(0, 0, width, height);
    const grad = ctx.createRadialGradient(width / 2, height / 2, 50, width / 2, height / 2, 400);
    grad.addColorStop(0, colors.tableGreen || "#1a6b35");
    grad.addColorStop(1, felt);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
}

// Vignette + grain are required for every canvas. Corner brackets are an
// optional duel-style flourish, enabled via opts.brackets.
function drawAtmosphere(ctx, width, height, colors, opts = {}) {
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

    ctx.save();
    const tile = getNoiseTile();
    const pattern = ctx.createPattern(tile, "repeat");
    if (pattern) {
        ctx.globalAlpha = 0.04;
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, width, height);
    }
    ctx.restore();

    if (opts.brackets) {
        ctx.save();
        ctx.strokeStyle = withAlpha(colors.gold || "#ffd700", 0.55);
        ctx.lineWidth = 3;
        ctx.lineCap = "square";
        const inset = opts.bracketInset || 18;
        const len = opts.bracketLen || 32;
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
}

// Outlined + glowing title. Stroke in feltColor, fill in accent. Same
// treatment is reused for win/loss banners (pass colors.textWin / textLoss
// as accent).
function drawTitle(ctx, cx, y, text, accent, colors, opts = {}) {
    const felt = colors.feltColor || "#0f4c25";
    const size = opts.size || 46;
    const fontFamily = opts.fontFamily || "Arial";
    ctx.save();
    ctx.font = `bold ${size}px ${fontFamily}`;
    ctx.textAlign = opts.textAlign || "center";
    ctx.textBaseline = opts.baseline || "middle";
    ctx.shadowColor = withAlpha(accent, 0.85);
    ctx.shadowBlur = opts.shadowBlur || 22;
    ctx.lineWidth = opts.lineWidth || 5;
    ctx.strokeStyle = felt;
    ctx.strokeText(text, cx, y);
    ctx.shadowBlur = 0;
    ctx.fillStyle = accent;
    ctx.fillText(text, cx, y);
    ctx.restore();
}

// Information group container. Translucent felt fill, inner radial vignette,
// gold border. opts.accent = thicker + gold for active/featured panels.
function drawPanel(ctx, x, y, w, h, colors, opts = {}) {
    const felt = colors.feltDark || colors.feltOuter || colors.feltColor || "#0a3a1a";
    const border = colors.layoutLine || colors.gold || "#ffd700";
    const radius = opts.radius || 14;

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = withAlpha(felt, opts.fillAlpha || 0.82);
    roundRect(ctx, x, y, w, h, radius);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ctx, x, y, w, h, radius);
    ctx.clip();
    const cx = x + w / 2;
    const cy = y + h / 2;
    const vg = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.15, cx, cy, Math.max(w, h) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = vg;
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    ctx.strokeStyle = opts.accent ? (colors.gold || border) : border;
    ctx.lineWidth = opts.accent ? 2.5 : 1.5;
    roundRect(ctx, x, y, w, h, radius);
    ctx.stroke();
}

function drawPanelHeading(ctx, x, y, w, label, colors) {
    const gold = colors.gold || "#ffd700";
    ctx.save();
    ctx.font = "bold 13px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = withAlpha(gold, 0.95);
    ctx.fillText(label, x + 14, y + 16);

    ctx.strokeStyle = withAlpha(gold, 0.4);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 14, y + 28);
    ctx.lineTo(x + w - 14, y + 28);
    ctx.stroke();
    ctx.restore();
}

// Circular avatar with a colored ring and drop shadow. ringColor is the
// user's per-session color (or gold). fillFallback is used when img is null.
function drawAvatarCircle(ctx, cx, cy, radius, img, ringColor, fillFallback) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
    ctx.fillStyle = ringColor || "#ffd700";
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    if (img) {
        ctx.drawImage(img, cx - radius, cy - radius, radius * 2, radius * 2);
    } else {
        ctx.fillStyle = fillFallback || "#222";
        ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    }
    ctx.restore();
}

// Card-game section: translucent tableGreen-tinted box with inner vignette
// and a goldDark border. Used by blackjack and poker for hand rows.
function drawSectionBg(ctx, x, y, w, h, colors) {
    ctx.fillStyle = withAlpha(colors.tableGreen, 0.65);
    roundRect(ctx, x, y, w, h, 12);
    ctx.fill();

    ctx.save();
    roundRect(ctx, x, y, w, h, 12);
    ctx.clip();
    const cx = x + w / 2;
    const cy = y + h / 2;
    const grad = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.18, cx, cy, Math.max(w, h) * 0.7);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    ctx.strokeStyle = colors.goldDark || colors.gold || "#c8a830";
    ctx.lineWidth = 3;
    roundRect(ctx, x, y, w, h, 12);
    ctx.stroke();
}

// Stamp the winner-crown above an avatar or the loser-fracture over it.
// Wins/losses rely on the sprite alone; pushes get nothing.
function stampAvatarOutcome(ctx, avatarX, avatarY, size, outcome, sprites) {
    if (outcome === "win" && sprites.crown) {
        const w = Math.round(size * 0.72);
        const h = w;
        ctx.drawImage(sprites.crown, avatarX + (size - w) / 2, avatarY - h + 4, w, h);
    } else if (outcome === "loss" && sprites.fracture) {
        const w = Math.round(size * 0.95);
        const h = w;
        ctx.drawImage(sprites.fracture, avatarX + (size - w) / 2, avatarY + (size - h) / 2, w, h);
    }
}

// Loss-only dim overlay clipped to a section/panel. Reliable in node-canvas
// (unlike globalCompositeOperation).
function applyOutcomeOverlay(ctx, x, y, w, h, outcome, radius = 12) {
    if (outcome !== "loss") return;
    ctx.save();
    roundRect(ctx, x, y, w, h, radius);
    ctx.clip();
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x, y, w, h);
    ctx.restore();
}

module.exports = {
    withAlpha,
    roundRect,
    getNoiseTile,
    loadSprite,
    loadBackgroundImage,
    loadUserAvatar,
    loadAvatarByUrl,
    drawBackground,
    drawAtmosphere,
    drawTitle,
    drawPanel,
    drawPanelHeading,
    drawAvatarCircle,
    drawSectionBg,
    stampAvatarOutcome,
    applyOutcomeOverlay,
};
