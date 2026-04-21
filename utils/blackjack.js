const CARDS = [
    { name: 'Ace',   char: 'A',  value: 11 },
    { name: 'Two',   char: '2',  value: 2  },
    { name: 'Three', char: '3',  value: 3  },
    { name: 'Four',  char: '4',  value: 4  },
    { name: 'Five',  char: '5',  value: 5  },
    { name: 'Six',   char: '6',  value: 6  },
    { name: 'Seven', char: '7',  value: 7  },
    { name: 'Eight', char: '8',  value: 8  },
    { name: 'Nine',  char: '9',  value: 9  },
    { name: 'Ten',   char: '10', value: 10 },
    { name: 'Jack',  char: 'J',  value: 10 },
    { name: 'Queen', char: 'Q',  value: 10 },
    { name: 'King',  char: 'K',  value: 10 },
];

function getHandValue(hand) {
    let total = 0;
    let aces = 0;
    for (let i = 0; i < hand.length; i++) {
        total += hand[i].value;
        if (hand[i].name === 'Ace') aces++;
    }
    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }
    return total;
}

function statusFromValue(total) {
    if (total > 21) return 'bust';
    if (total === 21) return 'blackjack';
    return 'safe';
}

function checkHand(hand) {
    return statusFromValue(getHandValue(hand));
}

function canSplit(hand) {
    return hand.length === 2 && hand[0].char === hand[1].char;
}

function isAcePair(hand) {
    return hand.length === 2 && hand[0].name === 'Ace' && hand[1].name === 'Ace';
}

function dealCards() {
    return CARDS[Math.floor(Math.random() * CARDS.length)];
}

function hit(hand) {
    hand.push(dealCards());
    return hand;
}

function dealerChoice(dealerHand) {
    return getHandValue(dealerHand) < 17 ? 'hit' : 'stand';
}

module.exports = {
    getHandValue,
    statusFromValue,
    checkHand,
    canSplit,
    isAcePair,
    dealCards,
    hit,
    dealerChoice,
};
