function getHandValue(hand) {
    let total = 0;
    let aces = 0;
    for (let i = 0; i < hand.length; i++) {
        total += hand[i].numericValue;
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

function dealerChoice(dealerHand) {
    return getHandValue(dealerHand) < 17 ? 'hit' : 'stand';
}

module.exports = {
    getHandValue,
    statusFromValue,
    checkHand,
    canSplit,
    isAcePair,
    dealerChoice,
};
