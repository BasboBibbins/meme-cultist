async function getHandValue(hand) {
    let total = 0;
    let aces = 0;
    for (let i = 0; i < hand.length; i++) {
        total += hand[i].value;
        if (hand[i].name === "Ace") aces++;
    }
    // Adjust for aces (can be 1 or 11)
    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }
    return total;
}

async function canSplit(hand) {
    // Can only split with exactly 2 cards of the same rank
    if (hand.length !== 2) return false;
    return hand[0].char === hand[1].char;
}

async function isAcePair(hand) {
    return hand.length === 2 && hand[0].name === "Ace" && hand[1].name === "Ace";
}

async function dealCards() {
    const cards = [
        { name: 'Ace', char: 'A', value: 11 },
        { name: 'Two', char: '2', value: 2 },
        { name: 'Three', char: '3', value: 3 },
        { name: 'Four', char: '4', value: 4 },
        { name: 'Five', char: '5', value: 5 },
        { name: 'Six', char: '6', value: 6 },
        { name: 'Seven', char: '7', value: 7 },
        { name: 'Eight', char: '8', value: 8 },
        { name: 'Nine', char: '9', value: 9 },
        { name: 'Ten', char: '10', value: 10 },
        { name: 'Jack', char: 'J', value: 10 },
        { name: 'Queen', char: 'Q', value: 10 },
        { name: 'King', char: 'K', value: 10 },
    ];
    const card = cards[Math.floor(Math.random() * cards.length)];
    return card;
}

module.exports = {
    dealCards : async function () {
        return dealCards();
    },
    getHandValue : async function (hand) {
        return getHandValue(hand);
    },
    checkHand : async function (hand) {
        let total = await getHandValue(hand);
        if (total > 21) {
            return "bust";
        }
        if (total == 21) {
            return "blackjack";
        }
        return "safe";
    },
    hit: async function (hand) {
        hand.push(await this.dealCards());
        return hand;
    },
    dealerChoice: async function (dealerHand) {
        let dealerTotal = await getHandValue(dealerHand);
        if (dealerTotal < 17) {
            return "hit";
        }
        return "stand";
    },
    canSplit: async function (hand) {
        return canSplit(hand);
    },
    isAcePair: async function (hand) {
        return isAcePair(hand);
    }
}
