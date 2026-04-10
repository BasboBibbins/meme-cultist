const { drawCard } = require('./deckofcards');
const { createCanvas, loadImage } = require('canvas');
const logger = require("./logger");
const { AttachmentBuilder } = require('discord.js');
const { getThemeColors } = require('../themes/resolver');

// Canvas dimensions matching roulette aesthetic
const CANVAS_W = 600;
const CANVAS_H = 320;

// Default poker colors (classic theme fallback)
const DEFAULT_COLORS = getThemeColors('classic', 'poker');

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

        values.sort((a, b) => {
            return a - b;
        });
        suits.sort();
        logger.debug(`values: ${values}, suits: ${suits}`);

        const isFlush = suits[0] === suits[1] && suits[1] === suits[2] && suits[2] === suits[3] && suits[3] === suits[4];
        const isStraight = (values[0] + 1 === values[1] && values[1] + 1 === values[2] && values[2] + 1 === values[3] && values[3] + 1 === values[4]) || (values[0] === 2 && values[1] === 3 && values[2] === 4 && values[3] === 5 && values[4] === 14); // ace low check
        const isRoyalFlush = (values[0] === 10 && values[1] === 11 && values[2] === 12 && values[3] === 13 && values[4] === 14) && (isFlush);
        const isStraightFlush = isStraight && isFlush;
        const isFourOfAKind = (values[0] === values[1] && values[1] === values[2] && values[2] === values[3]) || (values[1] === values[2] && values[2] === values[3] && values[3] === values[4]);
        const isFullHouse = (values[0] === values[1] && values[1] === values[2] && values[3] === values[4]) || (values[0] === values[1] && values[2] === values[3] && values[3] === values[4]);
        const isThreeOfAKind = (values[0] === values[1] && values[1] === values[2]) || (values[1] === values[2] && values[2] === values[3]) || (values[2] === values[3] && values[3] === values[4]);
        const isTwoPair = (values[0] === values[1] && values[2] === values[3]) || (values[0] === values[1] && values[3] === values[4]) || (values[1] === values[2] && values[3] === values[4]);
        const isJacksOrBetter = (values[0] === values[1] && values[0] >= 11) || (values[1] === values[2] && values[1] >= 11) || (values[2] === values[3] && values[2] >= 11) || (values[3] === values[4] && values[3] >= 11);

        if (isRoyalFlush) {
            logger.debug('Royal Flush');
            return 'Royal Flush';
        } else
        if (isStraightFlush) {
            logger.debug('Straight Flush');
            return 'Straight Flush';
        } else
        if (isFourOfAKind) {
            logger.debug('Four of a Kind');
            return 'Four of a Kind';
        } else
        if (isFullHouse) {
            logger.debug('Full House');
            return 'Full House';
        } else
        if (isFlush) {
            logger.debug('Flush');
            return 'Flush';
        } else
        if (isStraight) {
            logger.debug('Straight');
            return 'Straight';
        } else
        if (isThreeOfAKind) {
            logger.debug('Three of a Kind');
            return 'Three of a Kind';
        } else
        if (isTwoPair) {
            logger.debug('Two Pair');
            return 'Two Pair';
        } else
        if (isJacksOrBetter) {
            logger.debug('Jacks or Better');
            return 'Jacks or Better';
        } else {
            return null;
        }
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
    canvasHand: async (hand, score, colors = DEFAULT_COLORS) => {
        try {
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

            // Draw title with gold styling
            ctx.fillStyle = colors.gold;
            ctx.font = 'bold 28px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('VIDEO POKER', CANVAS_W / 2, 40);

            // Card area background with rounded corners
            const cardAreaX = 30, cardAreaY = 70;
            const cardAreaW = CANVAS_W - 60, cardAreaH = 200;
            ctx.fillStyle = colors.tableGreen;
            roundRect(ctx, cardAreaX, cardAreaY, cardAreaW, cardAreaH, 12);
            ctx.fill();
            ctx.strokeStyle = colors.goldDark;
            ctx.lineWidth = 3;
            roundRect(ctx, cardAreaX, cardAreaY, cardAreaW, cardAreaH, 12);
            ctx.stroke();

            // Card dimensions and spacing
            const cardW = 90, cardH = 135;
            const cardSpacing = 14;
            const totalCardsWidth = (cardW * 5) + (cardSpacing * 4);
            const startCardX = (CANVAS_W - totalCardsWidth) / 2;
            const cardY = cardAreaY + (cardAreaH - cardH) / 2;

            // Load and draw cards
            for (let i = 0; i < 5; i++) {
                const cardX = startCardX + i * (cardW + cardSpacing);
                const card = await loadImage(hand[i].image);

                // Card shadow
                ctx.fillStyle = 'rgba(0,0,0,0.35)';
                roundRect(ctx, cardX + 3, cardY + 3, cardW, cardH, 8);
                ctx.fill();

                // Draw card image
                ctx.drawImage(card, cardX, cardY, cardW, cardH);

                // Gold border on held cards
                if (hand[i].hold) {
                    ctx.strokeStyle = colors.gold;
                    ctx.lineWidth = 4;
                    roundRect(ctx, cardX - 2, cardY - 2, cardW + 4, cardH + 4, 10);
                    ctx.stroke();

                    // HOLD label with shadow
                    ctx.fillStyle = 'rgba(0,0,0,0.6)';
                    ctx.font = 'bold 14px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText('HOLD', cardX + cardW / 2, cardY - 6);
                    ctx.fillStyle = colors.gold;
                    ctx.fillText('HOLD', cardX + cardW / 2 + 1, cardY - 5);
                }
            }

            // Score display at bottom
            if (score) {
                const scoreY = CANVAS_H - 35;
                ctx.fillStyle = 'rgba(0,0,0,0.4)';
                roundRect(ctx, CANVAS_W / 2 - 120, scoreY - 20, 240, 40, 10);
                ctx.fill();

                ctx.strokeStyle = colors.gold;
                ctx.lineWidth = 2;
                roundRect(ctx, CANVAS_W / 2 - 120, scoreY - 20, 240, 40, 10);
                ctx.stroke();

                ctx.fillStyle = colors.gold;
                ctx.font = 'bold 22px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(score, CANVAS_W / 2, scoreY);
            }

            const buffer = canvas.toBuffer('image/png');
            const file = new AttachmentBuilder(buffer)
                .setName('hand.png');
            return file;
        } catch (err) {
            logger.error(err);
            return null;
        }
    },
    getCard: async (deckId) => {
        try {
            const card = await drawCard(deckId);
            return card.image;
        } catch (err) {
            logger.error(err);
            return null;
        }
    }
}