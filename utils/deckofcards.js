const logger = require('./logger');
const { pokerScore } = require('./poker');

module.exports = {
    newDeck: async () => {
        try {
            const res = await fetch('https://deckofcardsapi.com/api/deck/new/shuffle/?deck_count=1');
            const json = await res.json();
            return json.deck_id;
        } catch (err) {
            logger.error(err);
            return null;
        }
    },
    dealHand: async (deckId) => {
        try {
            const res = await fetch(`https://deckofcardsapi.com/api/deck/${deckId}/draw/?count=5`);
            const json = await res.json();
            if (json.success) {
                json.cards.forEach(card => {
                    card.hold = false;
                    if (card.suit === 'SPADES') card.emoji = '♠️';
                    if (card.suit === 'HEARTS') card.emoji = '♥️';
                    if (card.suit === 'DIAMONDS') card.emoji = '♦️';
                    if (card.suit === 'CLUBS') card.emoji = '♣️';
                });
                json.cards.score = await pokerScore(json.cards);
                return json.cards;
            } else {
                logger.error(json.error);
                return null;
            }
        } catch (err) {
            logger.error(err);
            return null;
        }
    },
    drawCard: async (deckId) => {
        try {
            const res = await fetch(`https://deckofcardsapi.com/api/deck/${deckId}/draw/?count=1`);
            const json = await res.json();
            if (json.success) {
                return json.cards[0];
            } else {
                logger.error(json.error);
                return null;
            }
        } catch (err) {
            logger.error(err);
            return null;
        }
    },
    shuffleDeck: async (deckId) => {
        try {
            const res = await fetch(`https://deckofcardsapi.com/api/deck/${deckId}/shuffle/`);
            const json = await res.json();
            return json.success;
        } catch (err) {
            logger.error(err);
            return null;
        }
    }
}