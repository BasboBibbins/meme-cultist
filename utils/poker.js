const { drawCard } = require('./deckofcards');
const { createCanvas, loadImage } = require('canvas');
const logger = require("./logger");
const { AttachmentBuilder } = require('discord.js');

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
    canvasHand: async (hand, score) => {
        try {
            const canvas = createCanvas(540, 250);
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            for (let i = 0; i < 5; i++) {
                const card = await loadImage(hand[i].image);
                ctx.drawImage(card, (110 * i), 100, 100, 150);
            }
            ctx.font = '24px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 5;
            ctx.lineJoin = 'round';
            for (let i = 0; i < 5; i++) {
                if (hand[i].hold) {
                    ctx.strokeText("HOLD", (110 * i) + 50, 75);
                    ctx.fillStyle = 'white';
                    ctx.fillText("HOLD", (110 * i) + 50, 75);
                }
            }
            ctx.font = '48px Arial';
            if (score) {
                ctx.strokeText(score, 270, 0);
                ctx.fillStyle = 'white';
                ctx.fillText(score, 270, 0);
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