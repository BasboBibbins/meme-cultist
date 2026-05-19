const crypto = require("crypto");

const SUITS = [
    { name: "SPADES", emoji: "♠️" },
    { name: "HEARTS", emoji: "♥️" },
    { name: "DIAMONDS", emoji: "♦️" },
    { name: "CLUBS", emoji: "♣️" },
];

const RANKS = [
    { value: "ACE", code: "A", name: "Ace", char: "A", numericValue: 11 },
    { value: "2", code: "2", name: "Two", char: "2", numericValue: 2 },
    { value: "3", code: "3", name: "Three", char: "3", numericValue: 3 },
    { value: "4", code: "4", name: "Four", char: "4", numericValue: 4 },
    { value: "5", code: "5", name: "Five", char: "5", numericValue: 5 },
    { value: "6", code: "6", name: "Six", char: "6", numericValue: 6 },
    { value: "7", code: "7", name: "Seven", char: "7", numericValue: 7 },
    { value: "8", code: "8", name: "Eight", char: "8", numericValue: 8 },
    { value: "9", code: "9", name: "Nine", char: "9", numericValue: 9 },
    { value: "10", code: "0", name: "Ten", char: "10", numericValue: 10 },
    { value: "JACK", code: "J", name: "Jack", char: "J", numericValue: 10 },
    { value: "QUEEN", code: "Q", name: "Queen", char: "Q", numericValue: 10 },
    { value: "KING", code: "K", name: "King", char: "K", numericValue: 10 },
];

const STANDARD_DECK = Object.freeze(
    SUITS.flatMap(suit =>
        RANKS.map(rank => ({
            code: `${rank.code}${suit.name[0]}`,
            suit: suit.name,
            value: rank.value,
            emoji: suit.emoji,
            name: rank.name,
            char: rank.char,
            numericValue: rank.numericValue,
        }))
    )
);

const decks = new Map();

function shuffle(cards) {
    const arr = cards.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

const { loadImage } = require("canvas");
const { getCardSheet } = require("../themes/resolver");

const sheetCache = new Map();
const backCache = new Map();

async function loadCardSheet(themeId) {
    const cfg = getCardSheet(themeId);
    if (!sheetCache.has(cfg.sheet)) sheetCache.set(cfg.sheet, await loadImage(cfg.sheet));
    return { img: sheetCache.get(cfg.sheet), cfg };
}

// Returns the cached card-back image for a theme, or null if the theme has no
// back asset or the image fails to load. Cached null marks "tried and failed"
// to avoid retrying broken paths on every render.
async function loadCardBack(themeId) {
    const cfg = getCardSheet(themeId);
    if (!cfg.back) return null;
    if (!backCache.has(cfg.back)) {
        try {
            backCache.set(cfg.back, await loadImage(cfg.back));
        } catch (_) {
            backCache.set(cfg.back, null);
        }
    }
    return backCache.get(cfg.back);
}

function getCardSpriteCoords(cardCode, cfg) {
    const rank = cardCode.slice(0, -1);
    const suitChar = cardCode.slice(-1);
    const suit = { C: "CLUBS", D: "DIAMONDS", H: "HEARTS", S: "SPADES" }[suitChar];
    const ri = cfg.ranksOrder.indexOf(rank);
    const si = cfg.suitsOrder.indexOf(suit);
    if (ri < 0 || si < 0) throw new Error(`Invalid card code: ${cardCode}`);
    return { sx: ri * cfg.cardWidth, sy: si * cfg.cardHeight, sw: cfg.cardWidth, sh: cfg.cardHeight };
}

async function warmCardCache(themeId = "classic") {
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
        return { ...state.cards[state.index++] };
    },
    dealHand: async (deckId) => {
        const { pokerScore } = require("./poker");
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
    loadCardBack,
    getCardSpriteCoords,
    warmCardCache,
};
