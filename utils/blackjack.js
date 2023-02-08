async function getHandValue(hand) {
    let total = 0;
    for (let i = 0; i < hand.length; i++) {
        total += hand[i].value;
    }
    if (total > 21) {
        for (let i = 0; i < hand.length; i++) {
            if (hand[i].name == "Ace") {
                total -= 10;
            }
        }
    }
    return total;
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
    dealerChoice: async function (hand) {
        let total = await getHandValue(hand);
        if (total < 17) {
            return "hit";
        }
        return "stand";
    }
}
