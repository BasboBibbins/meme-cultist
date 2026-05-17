const { createCanvas } = require('canvas');
const logger = require("./logger");
const { AttachmentBuilder } = require('discord.js');
const { getThemeColors } = require('../themes/resolver');
const { loadCardSheet, getCardSpriteCoords } = require('./cards');
const {
    roundRect,
    loadSprite,
    loadUserAvatar,
    drawBackground,
    drawAtmosphere,
    drawTitle,
    drawAvatarCircle,
    drawSectionBg,
    stampAvatarOutcome,
    applyOutcomeOverlay,
} = require('./canvasCommon');

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

        await drawBackground(ctx, CANVAS_W, CANVAS_H, colors);
        drawAtmosphere(ctx, CANVAS_W, CANVAS_H, colors);

        // Title swaps to outcome state once resolved.
        let titleText = 'VIDEO POKER';
        let titleAccent = colors.gold;
        if (outcome === 'win') {
            titleText = 'YOU WIN';
            titleAccent = colors.textWin || '#44ff44';
        } else if (outcome === 'loss') {
            titleText = 'YOU LOSE';
            titleAccent = colors.textLoss || '#ff4444';
        }
        drawTitle(ctx, CANVAS_W / 2, MARGIN, titleText, titleAccent, colors, { size: 40, baseline: 'top' });

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
        drawAvatarCircle(ctx, avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2, AVATAR_SIZE / 2, playerAvatar, colors.gold, colors.feltDark);

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
