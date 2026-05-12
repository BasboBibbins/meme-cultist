const { createCanvas, loadImage } = require('canvas');
const logger = require("./logger");
const { AttachmentBuilder } = require('discord.js');
const { getThemeColors } = require('../themes/resolver');
const { loadCardSheet, getCardSpriteCoords } = require('./cards');

const CARD_W = 90;
const CARD_H = 135;
const CARD_SPACING = 14;
const AVATAR_SIZE = 50;
const AVATAR_GAP = 10;
const SCORE_PILL_W = 240;
const SCORE_PILL_H = 40;
const MARGIN = 30;
const HEADER_H = 55;
const LABEL_H = 24;
const SECTION_PADDING = 16;
const SECTION_GAP = 20;

const CANVAS_W = MARGIN * 2 + SECTION_PADDING * 2 + AVATAR_SIZE + CARD_SPACING + CARD_W * 5 + CARD_SPACING * 4;

const DEFAULT_COLORS = getThemeColors('classic', 'poker');

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

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
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

    // Dark radial vignette overlay clipped to the section — gives the cards
    // a spotlit feel matching blackjack/duel.
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
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2 + 3, 0, Math.PI * 2);
    ctx.fillStyle = colors.gold || "#ffd700";
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (img) {
        ctx.drawImage(img, x, y, size, size);
    } else {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(x, y, size, size);
    }
    ctx.restore();
}

function stampAvatarOutcome(ctx, avatarX, avatarY, size, outcome, sprites) {
    if (outcome === "win" && sprites.crown) {
        const w = Math.round(size * 0.72);
        const h = w;
        ctx.drawImage(sprites.crown, avatarX + (size - w) / 2, avatarY - h + 4, w, h);
    } else if (outcome === "loss" && sprites.fracture) {
        const w = Math.round(size * 1.2);
        const h = w;
        ctx.drawImage(sprites.fracture, avatarX + (size - w) / 2, avatarY + (size - h) / 2, w, h);
    }
}

function applyOutcomeOverlay(ctx, x, y, w, h, outcome) {
    if (outcome !== "loss") return;
    ctx.save();
    roundRect(ctx, x, y, w, h, 12);
    ctx.clip();
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x, y, w, h);
    ctx.restore();
}

async function pokerScore(hand) {
    try {
        const suits = [];
        const values = [];

        for (let i = 0; i < 5; i++) {
            suits.push(hand[i].suit);
            if (hand[i].value === 'JACK') {
                values[i] = 11;
            } else
            if (hand[i].value === 'QUEEN') {
                values[i] = 12;
            } else
            if (hand[i].value === 'KING') {
                values[i] = 13;
            } else
            if (hand[i].value === 'ACE') {
                values[i] = 14;
            } else {
                values[i] = parseInt(hand[i].value);
            }
        }

        values.sort((a, b) => a - b);
        suits.sort();
        logger.debug(`values: ${values}, suits: ${suits}`);

        const isFlush = suits[0] === suits[1] && suits[1] === suits[2] && suits[2] === suits[3] && suits[3] === suits[4];
        const isStraight = (values[0] + 1 === values[1] && values[1] + 1 === values[2] && values[2] + 1 === values[3] && values[3] + 1 === values[4]) || (values[0] === 2 && values[1] === 3 && values[2] === 4 && values[3] === 5 && values[4] === 14);
        const isRoyalFlush = (values[0] === 10 && values[1] === 11 && values[2] === 12 && values[3] === 13 && values[4] === 14) && (isFlush);
        const isStraightFlush = isStraight && isFlush;
        const isFourOfAKind = (values[0] === values[1] && values[1] === values[2] && values[2] === values[3]) || (values[1] === values[2] && values[2] === values[3] && values[3] === values[4]);
        const isFullHouse = (values[0] === values[1] && values[1] === values[2] && values[3] === values[4]) || (values[0] === values[1] && values[2] === values[3] && values[3] === values[4]);
        const isThreeOfAKind = (values[0] === values[1] && values[1] === values[2]) || (values[1] === values[2] && values[2] === values[3]) || (values[2] === values[3] && values[3] === values[4]);
        const isTwoPair = (values[0] === values[1] && values[2] === values[3]) || (values[0] === values[1] && values[3] === values[4]) || (values[1] === values[2] && values[3] === values[4]);
        const isJacksOrBetter = (values[0] === values[1] && values[0] >= 11) || (values[1] === values[2] && values[1] >= 11) || (values[2] === values[3] && values[2] >= 11) || (values[3] === values[4] && values[3] >= 11);

        if (isRoyalFlush) return 'Royal Flush';
        if (isStraightFlush) return 'Straight Flush';
        if (isFourOfAKind) return 'Four of a Kind';
        if (isFullHouse) return 'Full House';
        if (isFlush) return 'Flush';
        if (isStraight) return 'Straight';
        if (isThreeOfAKind) return 'Three of a Kind';
        if (isTwoPair) return 'Two Pair';
        if (isJacksOrBetter) return 'Jacks or Better';
        return null;
    } catch (err) {
        logger.error(err);
        return null;
    }
}

const ROYAL_FLUSH_HAND = [
    { code: '0S', hold: true },
    { code: 'JS', hold: true },
    { code: 'QS', hold: true },
    { code: 'KS', hold: true },
    { code: 'AS', hold: true },
];

async function pokerPreview(themeId) {
    const colors = getThemeColors(themeId, 'poker');
    return module.exports.canvasHand(ROYAL_FLUSH_HAND, 'Royal Flush', colors, themeId);
}

async function canvasHand(hand, score, colors = DEFAULT_COLORS, themeId = 'classic', opts = {}) {
    const { user = null, outcome = null } = opts;
    try {
        const sectionH = LABEL_H + SECTION_PADDING + CARD_H + SECTION_PADDING;
        const CANVAS_H = MARGIN + HEADER_H + SECTION_GAP + sectionH + SECTION_GAP + SCORE_PILL_H + MARGIN;

        const canvas = createCanvas(CANVAS_W, CANVAS_H);
        const ctx = canvas.getContext('2d');

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
                logger.warn('Failed to load poker background image, using fallback color', { error: err });
                ctx.fillStyle = colors.feltColor;
                ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
            }
        } else {
            ctx.fillStyle = colors.feltColor;
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        }

        // Title — outlined+glowing, swaps to outcome state once resolved.
        let titleText = 'VIDEO POKER';
        let titleAccent = colors.gold;
        if (outcome === 'win') {
            titleText = 'YOU WIN';
            titleAccent = colors.textWin || '#44ff44';
        } else if (outcome === 'loss') {
            titleText = 'YOU LOSE';
            titleAccent = colors.textLoss || '#ff4444';
        }
        ctx.save();
        ctx.font = 'bold 40px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.shadowColor = withAlpha(titleAccent, 0.85);
        ctx.shadowBlur = 22;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.lineWidth = 5;
        ctx.strokeStyle = colors.feltColor || '#0f4c25';
        ctx.strokeText(titleText, CANVAS_W / 2, MARGIN);
        ctx.shadowBlur = 0;
        ctx.fillStyle = titleAccent;
        ctx.fillText(titleText, CANVAS_W / 2, MARGIN);
        ctx.restore();

        const [playerAvatar, crownImg, fractureImg] = await Promise.all([
            loadUserAvatar(user),
            loadSprite(colors.crownSprite),
            loadSprite(colors.fractureSprite),
        ]);

        const { img: sheetImg, cfg: sheetCfg } = await loadCardSheet(themeId);

        const sectionX = MARGIN;
        const sectionY = MARGIN + HEADER_H + SECTION_GAP;
        const sectionW = CANVAS_W - MARGIN * 2;

        drawSectionBg(ctx, sectionX, sectionY, sectionW, sectionH, colors);

        // Label
        ctx.fillStyle = colors.textWhite || '#ffffff';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Your hand', sectionX + SECTION_PADDING, sectionY + SECTION_PADDING);

        const cardRowY = sectionY + LABEL_H + SECTION_PADDING;
        const avatarX = sectionX + SECTION_PADDING;
        const avatarY = cardRowY + (CARD_H - AVATAR_SIZE) / 2;
        drawAvatarCircle(ctx, avatarX, avatarY, AVATAR_SIZE, playerAvatar, colors);

        // Cards
        const cardsStartX = sectionX + SECTION_PADDING + AVATAR_SIZE + CARD_SPACING;
        for (let i = 0; i < 5; i++) {
            const cardX = cardsStartX + i * (CARD_W + CARD_SPACING);
            const c = getCardSpriteCoords(hand[i].code, sheetCfg);

            // Shadow under card
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            roundRect(ctx, cardX + 3, cardRowY + 3, CARD_W, CARD_H, 8);
            ctx.fill();

            ctx.drawImage(sheetImg, c.sx, c.sy, c.sw, c.sh, cardX, cardRowY, CARD_W, CARD_H);

            if (hand[i].hold) {
                ctx.strokeStyle = colors.gold;
                ctx.lineWidth = 4;
                roundRect(ctx, cardX - 2, cardRowY - 2, CARD_W + 4, CARD_H + 4, 10);
                ctx.stroke();

                ctx.fillStyle = 'rgba(0,0,0,0.6)';
                ctx.font = 'bold 14px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText('HOLD', cardX + CARD_W / 2 + 1, cardRowY - 5);
                ctx.fillStyle = colors.gold;
                ctx.fillText('HOLD', cardX + CARD_W / 2, cardRowY - 6);
            }
        }

        // Loss dim overlay on the section + crown/fracture on avatar.
        applyOutcomeOverlay(ctx, sectionX, sectionY, sectionW, sectionH, outcome);
        stampAvatarOutcome(ctx, avatarX, avatarY, AVATAR_SIZE, outcome, { crown: crownImg, fracture: fractureImg });

        // Score pill below the section, styled like blackjack's total badge.
        if (score) {
            const pillX = CANVAS_W / 2 - SCORE_PILL_W / 2;
            const pillY = sectionY + sectionH + SECTION_GAP;

            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            roundRect(ctx, pillX, pillY, SCORE_PILL_W, SCORE_PILL_H, 10);
            ctx.fill();
            ctx.strokeStyle = colors.gold;
            ctx.lineWidth = 2;
            roundRect(ctx, pillX, pillY, SCORE_PILL_W, SCORE_PILL_H, 10);
            ctx.stroke();

            ctx.fillStyle = colors.gold;
            ctx.font = 'bold 20px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(score, CANVAS_W / 2, pillY + SCORE_PILL_H / 2);
        }

        const buffer = canvas.toBuffer('image/png');
        return new AttachmentBuilder(buffer).setName('hand.png');
    } catch (err) {
        logger.error(err);
        return null;
    }
}

module.exports = {
    pokerScore: async (hand) => {
        try {
            return await pokerScore(hand);
        } catch (err) {
            logger.error(err);
            return null;
        }
    },
    canvasHand,
    pokerPreview,
};
