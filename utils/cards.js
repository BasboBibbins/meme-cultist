const crypto = require('crypto');

const SUITS = [
    { name: 'SPADES', emoji: '♠️' },
    { name: 'HEARTS', emoji: '♥️' },
    { name: 'DIAMONDS', emoji: '♦️' },
    { name: 'CLUBS', emoji: '♣️' },
];

const RANKS = [
    { value: 'ACE', code: 'A' },
    { value: '2', code: '2' },
    { value: '3', code: '3' },
    { value: '4', code: '4' },
    { value: '5', code: '5' },
    { value: '6', code: '6' },
    { value: '7', code: '7' },
    { value: '8', code: '8' },
    { value: '9', code: '9' },
    { value: '10', code: '0' },
    { value: 'JACK', code: 'J' },
    { value: 'QUEEN', code: 'Q' },
    { value: 'KING', code: 'K' },
];

const STANDARD_DECK = Object.freeze(
    SUITS.flatMap(suit =>
        RANKS.map(rank => ({
            code: `${rank.code}${suit.name[0]}`,
            suit: suit.name,
            value: rank.value,
            emoji: suit.emoji,
        }))
    )
);

/** @type {Map<string, { cards: typeof STANDARD_DECK[number][], index: number }>} */
const decks = new Map();

function shuffle(cards) {
    const arr = cards.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

const { loadImage } = require('canvas');
const { getCardSheet } = require('../themes/resolver');

const sheetCache = new Map();   // path -> loaded Image

async function loadCardSheet(themeId) {
    const cfg = getCardSheet(themeId);
    if (!sheetCache.has(cfg.sheet)) sheetCache.set(cfg.sheet, await loadImage(cfg.sheet));
    return { img: sheetCache.get(cfg.sheet), cfg };
}

function getCardSpriteCoords(cardCode, cfg) {
    const rank = cardCode.slice(0, -1);     // "A","0","K"...
    const suitChar = cardCode.slice(-1);    // "C","D","H","S"
    const suit = { C: 'CLUBS', D: 'DIAMONDS', H: 'HEARTS', S: 'SPADES' }[suitChar];
    const ri = cfg.ranksOrder.indexOf(rank);
    const si = cfg.suitsOrder.indexOf(suit);
    if (ri < 0 || si < 0) throw new Error(`Invalid card code: ${cardCode}`);
    return { sx: ri * cfg.cardWidth, sy: si * cfg.cardHeight, sw: cfg.cardWidth, sh: cfg.cardHeight };
}

async function warmCardCache(themeId = 'classic') {
    await loadCardSheet(themeId);
}

module.exports = {
    newDeck: async () => {
        const id = crypto.randomUUID();
        decks.set(id, { cards: shuffle([...STANDARD_DECK]), index: 0 });
        return id;
    },
    shuffleDeck: async (deckId) => {
        const state = decks.get(deckId);
        if (!state) return false;
        state.cards = shuffle(state.cards);
        state.index = 0;
        return true;
    },
    drawCard: async (deckId) => {
        const state = decks.get(deckId);
        if (!state) return null;
        if (state.index >= state.cards.length) {
            state.cards = shuffle([...STANDARD_DECK]);
            state.index = 0;
        }
        return state.cards[state.index++];
    },
    dealHand: async (deckId) => {
        const { pokerScore } = require('./poker');
        const cards = [];
        for (let i = 0; i < 5; i++) {
            cards.push(await module.exports.drawCard(deckId));
        }
        cards.forEach(card => {
            card.hold = false;
        });
        cards.score = await pokerScore(cards);
        return cards;
    },
    loadCardSheet,
    getCardSpriteCoords,
    warmCardCache,
};
