const {
    getHandValue,
    statusFromValue,
    checkHand,
    canSplit,
    isAcePair,
    dealerChoice,
} = require("../../utils/blackjack");

const card = (name, char, numericValue) => ({ name, char, numericValue });

const ace   = card("Ace",   "A",  11);
const king  = card("King",  "K",  10);
const queen = card("Queen", "Q",  10);
const ten   = card("Ten",   "10", 10);
const nine  = card("Nine",  "9",   9);
const eight = card("Eight", "8",   8);
const seven = card("Seven", "7",   7);
const six   = card("Six",   "6",   6);
const five  = card("Five",  "5",   5);
const two   = card("Two",   "2",   2);

describe("getHandValue", () => {
    test("sums simple cards", () => {
        expect(getHandValue([king, nine])).toBe(19);
    });

    test("ace counts as 11 when safe", () => {
        expect(getHandValue([ace, nine])).toBe(20);
    });

    test("ace counts as 1 to avoid bust", () => {
        expect(getHandValue([ace, king, five])).toBe(16);
    });

    test("two aces: one becomes 1", () => {
        expect(getHandValue([ace, ace, nine])).toBe(21);
    });

    test("natural blackjack with ace+king = 21", () => {
        expect(getHandValue([ace, king])).toBe(21);
    });

    test("bust hand stays over 21 after ace reduction", () => {
        expect(getHandValue([king, queen, five])).toBe(25);
    });
});

describe("statusFromValue", () => {
    test("returns safe for < 21", () => {
        expect(statusFromValue(20)).toBe("safe");
    });

    test("returns blackjack for exactly 21", () => {
        expect(statusFromValue(21)).toBe("blackjack");
    });

    test("returns bust for > 21", () => {
        expect(statusFromValue(22)).toBe("bust");
    });
});

describe("checkHand", () => {
    test("safe hand", () => {
        expect(checkHand([king, eight])).toBe("safe");
    });

    test("blackjack hand", () => {
        expect(checkHand([ace, king])).toBe("blackjack");
    });

    test("bust hand", () => {
        expect(checkHand([king, queen, five])).toBe("bust");
    });
});

describe("canSplit", () => {
    test("two cards with same char can split", () => {
        expect(canSplit([king, card("King", "K", 10)])).toBe(true);
    });

    test("different chars cannot split", () => {
        expect(canSplit([king, nine])).toBe(false);
    });

    test("more than two cards cannot split", () => {
        expect(canSplit([king, card("King", "K", 10), five])).toBe(false);
    });
});

describe("isAcePair", () => {
    test("two aces returns true", () => {
        expect(isAcePair([ace, ace])).toBe(true);
    });

    test("ace + king returns false", () => {
        expect(isAcePair([ace, king])).toBe(false);
    });

    test("three aces returns false", () => {
        expect(isAcePair([ace, ace, ace])).toBe(false);
    });
});

describe("dealerChoice", () => {
    test("hits below 17", () => {
        expect(dealerChoice([king, six])).toBe("hit");
    });

    test("stands at exactly 17", () => {
        expect(dealerChoice([king, seven])).toBe("stand");
    });

    test("stands above 17", () => {
        expect(dealerChoice([king, nine])).toBe("stand");
    });
});
