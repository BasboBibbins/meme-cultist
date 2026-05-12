const { createCanvas, loadImage } = require("canvas");
const logger = require("./logger");
const { AttachmentBuilder } = require("discord.js");
const { loadCardSheet, getCardSpriteCoords } = require("./cards");
const { getHandValue, statusFromValue } = require("./blackjack");

const CARD_W = 110;
const CARD_H = 165;
const CARD_SPACING = 16;
const CIRCLE_SIZE = 70;
const AVATAR_SIZE = 50;
const AVATAR_GAP = 10;
const MARGIN = 30;
const HEADER_H = 55;
const LABEL_H = 24;
const SECTION_PADDING = 16;
const SECTION_GAP = 20;
const MAX_CARDS_BEFORE_SCALE = 3;

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

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

const spriteCache = new Map();
function loadSprite(p) {
    if (!p) return Promise.resolve(null);
    if (spriteCache.has(p)) return spriteCache.get(p);
    const promise = loadImage(p).catch(() => null);
    spriteCache.set(p, promise);
    return promise;
}

const avatarCache = new Map();
async function loadUserAvatar(user) {
    if (!user) return null;
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

function drawSectionBg(ctx, x, y, w, h, colors) {
    ctx.fillStyle = hexToRgba(colors.tableGreen, 0.65);
    roundRect(ctx, x, y, w, h, 12);
    ctx.fill();

    // Dark radial vignette overlay clipped to the section — darkens edges to
    // give each hand a "spotlit" feel.
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

    ctx.strokeStyle = colors.goldDark;
    ctx.lineWidth = 3;
    roundRect(ctx, x, y, w, h, 12);
    ctx.stroke();
}

function drawAvatarCircle(ctx, x, y, size, img, colors) {
    const cx = x + size / 2;
    const cy = y + size / 2;
    // Gold ring
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2 + 3, 0, Math.PI * 2);
    ctx.fillStyle = colors.gold || "#ffd700";
    ctx.fill();

    if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, x, y, size, size);
        ctx.restore();
    } else {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(x, y, size, size);
        ctx.restore();
    }
}

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

function applyOutcomeOverlay(ctx, x, y, w, h, outcome) {
    // Losers get a dimming overlay clipped to the section. Wins and pushes
    // rely on the sprite stamp alone — no colored frame.
    if (outcome !== "loss") return;
    ctx.save();
    roundRect(ctx, x, y, w, h, 12);
    ctx.clip();
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x, y, w, h);
    ctx.restore();
}

function drawBadge(ctx, x, y, type) {
    const w = type === "bust" ? 44 : 34;
    const h = 18;
    const r = 4;
    let bg, text, textColor;

    if (type === "double") {
        bg = "#2ecc71";
        text = "2x";
        textColor = "#ffffff";
    } else if (type === "bust") {
        bg = "#e74c3c";
        text = "BUST";
        textColor = "#ffffff";
    } else if (type === "blackjack") {
        bg = "#f1c40f";
        text = "BJ";
        textColor = "#1a1a1a";
    } else {
        return w;
    }

    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = bg;
    ctx.fill();

    ctx.fillStyle = textColor;
    ctx.font = `bold ${type === 'bust' ? 11 : 12}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + w / 2, y + h / 2 + 1);

    return w;
}

function drawTotalCircle(ctx, x, y, size, total, colors, badges = []) {
    const cx = x + size / 2;
    const cy = y + size / 2;
    const radius = size / 2;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fill();
    ctx.strokeStyle = colors.gold;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = colors.gold;
    ctx.font = `bold ${Math.floor(size * 0.45)}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(total, cx, cy);

    if (badges.length > 0) {
        const badgeH = 18;
        const badgeGap = 4;
        let totalW = 0;
        const badgeWs = [];
        for (const b of badges) {
            const bw = b === "bust" ? 44 : 34;
            badgeWs.push(bw);
            totalW += bw;
        }
        totalW += (badges.length - 1) * badgeGap;

        let bx = cx - totalW / 2;
        const by = cy + radius + 6;
        for (let i = 0; i < badges.length; i++) {
            drawBadge(ctx, bx, by, badges[i]);
            bx += badgeWs[i] + badgeGap;
        }
    }
}

function drawCardBack(ctx, x, y, w, h, colors) {
    ctx.fillStyle = "#1a3a5c";
    roundRect(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = colors.goldDark || "#c8a830";
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, w, h, 8);
    ctx.stroke();

    ctx.fillStyle = colors.goldDark || "#c8a830";
    ctx.font = `bold ${Math.floor(h * 0.35)}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", x + w / 2, y + h / 2);
}

async function canvasBlackjack(dealerCards, playerHands, colors, themeId, revealHole = false, activeHandIndex = 0, opts = {}) {
    const { user = null, dealerUser = null, outcomes = [], dealerOutcome = null, playerOutcome = null } = opts;
    try {
        const maxDealerCards = dealerCards.length;
        const maxPlayerCards = playerHands.length > 0
            ? Math.max(...playerHands.map(h => h.cards.length))
            : 0;
        const maxCardsInRow = Math.max(maxDealerCards, maxPlayerCards, 2);
        const widthCards = maxCardsInRow > MAX_CARDS_BEFORE_SCALE ? maxCardsInRow : MAX_CARDS_BEFORE_SCALE;

        const rowContentWidth = SECTION_PADDING * 2 + CIRCLE_SIZE + CARD_SPACING + widthCards * CARD_W + (widthCards - 1) * CARD_SPACING;
        const CANVAS_W = Math.max(600, MARGIN * 2 + rowContentWidth);

        const sectionHeight = LABEL_H + SECTION_PADDING + CARD_H + SECTION_PADDING;
        const CANVAS_H = MARGIN + HEADER_H + SECTION_GAP + sectionHeight + playerHands.length * (sectionHeight + SECTION_GAP) + MARGIN;

        const canvas = createCanvas(CANVAS_W, CANVAS_H);
        const ctx = canvas.getContext("2d");

        // Background
        if (colors.background) {
            try {
                const bgImg = await loadImage(colors.background);
                const scale = Math.max(CANVAS_W / bgImg.width, CANVAS_H / bgImg.height);
                const drawW = bgImg.width * scale;
                const drawH = bgImg.height * scale;
                const dx = (CANVAS_W - drawW) / 2;
                const dy = (CANVAS_H - drawH) / 2;
                ctx.drawImage(bgImg, dx, dy, drawW, drawH);
            } catch (err) {
                logger.warn("Failed to load blackjack background image, using fallback color", { error: err });
                ctx.fillStyle = colors.feltColor;
                ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
            }
        } else {
            ctx.fillStyle = colors.feltColor;
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        }

        // Title — outlined, glowing, matching the duel banner treatment.
        // Once the game resolves, the title swaps to the player-perspective result.
        let titleText = "BLACKJACK";
        let titleAccent = colors.gold;
        if (playerOutcome === "win") {
            titleText = "YOU WIN";
            titleAccent = colors.textWin || "#44ff44";
        } else if (playerOutcome === "loss") {
            titleText = "YOU LOSE";
            titleAccent = colors.textLoss || "#ff4444";
        } else if (playerOutcome === "push") {
            titleText = "PUSH";
            titleAccent = colors.gold;
        }
        ctx.save();
        ctx.font = "bold 40px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.shadowColor = withAlpha(titleAccent, 0.85);
        ctx.shadowBlur = 22;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.lineWidth = 5;
        ctx.strokeStyle = colors.feltColor || "#0f4c25";
        ctx.strokeText(titleText, CANVAS_W / 2, MARGIN);
        ctx.shadowBlur = 0;
        ctx.fillStyle = titleAccent;
        ctx.fillText(titleText, CANVAS_W / 2, MARGIN);
        ctx.restore();

        // Pre-load avatars and shared outcome sprites in parallel.
        const [dealerAvatar, playerAvatar, crownImg, fractureImg] = await Promise.all([
            loadUserAvatar(dealerUser),
            loadUserAvatar(user),
            loadSprite(colors.crownSprite),
            loadSprite(colors.fractureSprite),
        ]);

        // Load sheet and back image
        const { img: sheetImg, cfg: sheetCfg } = await loadCardSheet(themeId);
        let backImg = null;
        if (sheetCfg.back) {
            try {
                backImg = await loadImage(sheetCfg.back);
            } catch (err) {
                logger.warn("Failed to load card back image", { error: err });
            }
        }

        let y = MARGIN + HEADER_H + SECTION_GAP;

        // ── Dealer section ───────────────────────────────
        const dealerTotal = revealHole
            ? getHandValue(dealerCards)
            : getHandValue(dealerCards.slice(0, 1));

        // Section background (poker-style tinted box with gold border)
        drawSectionBg(ctx, MARGIN, y, CANVAS_W - MARGIN * 2, sectionHeight, colors);

        // Label
        ctx.fillStyle = colors.textWhite;
        ctx.font = "bold 16px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText("Dealer", MARGIN + SECTION_PADDING, y + SECTION_PADDING);

        // Avatar above the total circle, stacked vertically and centered in the info column.
        const infoStackH = AVATAR_SIZE + AVATAR_GAP + CIRCLE_SIZE;
        const infoTop = y + LABEL_H + SECTION_PADDING + (CARD_H - infoStackH) / 2;
        const avatarColX = MARGIN + SECTION_PADDING + (CIRCLE_SIZE - AVATAR_SIZE) / 2;
        drawAvatarCircle(ctx, avatarColX, infoTop, AVATAR_SIZE, dealerAvatar, colors);

        // Total circle + cards
        const circleY = infoTop + AVATAR_SIZE + AVATAR_GAP;
        drawTotalCircle(ctx, MARGIN + SECTION_PADDING, circleY, CIRCLE_SIZE, dealerTotal, colors);

        for (let i = 0; i < dealerCards.length; i++) {
            const cardX = MARGIN + SECTION_PADDING + CIRCLE_SIZE + CARD_SPACING + i * (CARD_W + CARD_SPACING);
            const cardY = y + LABEL_H + SECTION_PADDING;
            if (i === 1 && !revealHole) {
                if (backImg) {
                    ctx.drawImage(backImg, cardX, cardY, CARD_W, CARD_H);
                } else {
                    drawCardBack(ctx, cardX, cardY, CARD_W, CARD_H, colors);
                }
            } else {
                const c = getCardSpriteCoords(dealerCards[i].code, sheetCfg);
                ctx.drawImage(sheetImg, c.sx, c.sy, c.sw, c.sh, cardX, cardY, CARD_W, CARD_H);
            }
        }

        applyOutcomeOverlay(ctx, MARGIN, y, CANVAS_W - MARGIN * 2, sectionHeight, dealerOutcome);
        stampAvatarOutcome(ctx, avatarColX, infoTop, AVATAR_SIZE, dealerOutcome, { crown: crownImg, fracture: fractureImg });

        y += sectionHeight + SECTION_GAP;

        // ── Player hands ───────────────────────────────────
        for (let hi = 0; hi < playerHands.length; hi++) {
            const hand = playerHands[hi];
            const handTotal = getHandValue(hand.cards);
            const handStatus = statusFromValue(handTotal);

            const multi = playerHands.length > 1;
            const label = multi ? `Hand ${hi + 1}` : "Your hand";

            // Status badges for this hand (shown under the total circle)
            const badges = [];
            if (hand.isDoubled) badges.push("double");
            if (handStatus === "bust") badges.push("bust");
            else if (handStatus === "blackjack") badges.push("blackjack");

            // Section background
            drawSectionBg(ctx, MARGIN, y, CANVAS_W - MARGIN * 2, sectionHeight, colors);

            // Label
            const isActive = hi === activeHandIndex;
            ctx.fillStyle = isActive ? colors.gold : colors.textWhite;
            ctx.font = "bold 16px Arial";
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            ctx.fillText(label, MARGIN + SECTION_PADDING, y + SECTION_PADDING);

            // Avatar above the total circle.
            const pInfoStackH = AVATAR_SIZE + AVATAR_GAP + CIRCLE_SIZE;
            const pInfoTop = y + LABEL_H + SECTION_PADDING + (CARD_H - pInfoStackH) / 2;
            const pAvatarColX = MARGIN + SECTION_PADDING + (CIRCLE_SIZE - AVATAR_SIZE) / 2;
            drawAvatarCircle(ctx, pAvatarColX, pInfoTop, AVATAR_SIZE, playerAvatar, colors);

            // Total circle + cards
            const pCircleY = pInfoTop + AVATAR_SIZE + AVATAR_GAP;
            drawTotalCircle(ctx, MARGIN + SECTION_PADDING, pCircleY, CIRCLE_SIZE, handTotal, colors, badges);

            for (let ci = 0; ci < hand.cards.length; ci++) {
                const cardX = MARGIN + SECTION_PADDING + CIRCLE_SIZE + CARD_SPACING + ci * (CARD_W + CARD_SPACING);
                const cardY = y + LABEL_H + SECTION_PADDING;
                const c = getCardSpriteCoords(hand.cards[ci].code, sheetCfg);
                ctx.drawImage(sheetImg, c.sx, c.sy, c.sw, c.sh, cardX, cardY, CARD_W, CARD_H);
            }

            // Loss dimming overlay (win/push leave the section unchanged).
            applyOutcomeOverlay(ctx, MARGIN, y, CANVAS_W - MARGIN * 2, sectionHeight, outcomes[hi]);
            // Crown above winner avatar / fracture over loser avatar — drawn
            // after the dim overlay so the sprite itself stays crisp.
            stampAvatarOutcome(ctx, pAvatarColX, pInfoTop, AVATAR_SIZE, outcomes[hi], { crown: crownImg, fracture: fractureImg });

            y += sectionHeight + SECTION_GAP;
        }

        const buffer = canvas.toBuffer("image/png");
        return new AttachmentBuilder(buffer).setName("blackjack.png");
    } catch (err) {
        logger.error("Failed to render blackjack canvas", { error: err });
        return null;
    }
}

module.exports = { canvasBlackjack };
