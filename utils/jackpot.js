const { QuickDB } = require('quick.db');
const db = new QuickDB({ filePath: './db/jackpot.sqlite' });
const logger = require('./logger');
const { JACKPOT_SEED, JACKPOT_CONTRIBUTION_RATE, JACKPOT_MIN_BET, JACKPOT_INTEREST_RATE_PERCENT, CURRENCY_NAME } = require('../config.js');

// Default values if not in config
const SEED = JACKPOT_SEED ?? 1000;
const RATE = JACKPOT_CONTRIBUTION_RATE ?? 0.02;  // 2%
const MIN_BET = JACKPOT_MIN_BET ?? 10;
const CURRENCY = CURRENCY_NAME ?? 'koku';

async function getJackpot() {
    const jackpot = await db.get('progressive');
    if (!jackpot) {
        // Initialize if not exists
        const initial = { amount: SEED, lastWon: null, lastWinner: null };
        await db.set('progressive', initial);
        return initial;
    }
    return jackpot;
}

async function contributeToJackpot(betAmount) {
    // Minimum 1 contribution, calculated as percentage of bet
    const contribution = Math.max(1, Math.floor(betAmount * RATE));
    const jackpot = await getJackpot();

    await db.set('progressive', {
        ...jackpot,
        amount: jackpot.amount + contribution
    });

    logger.debug(`Jackpot contribution: ${contribution} ${CURRENCY} (from bet of ${betAmount})`);
    return contribution;
}

async function winJackpot(userId, username) {
    const jackpot = await getJackpot();
    const wonAmount = jackpot.amount;

    const newJackpot = {
        amount: SEED,
        lastWon: Date.now(),
        lastWinner: { id: userId, name: username, wonAmount: wonAmount }
    };

    await db.set('progressive', newJackpot);
    logger.log(`JACKPOT WON: ${username} (${userId}) won ${wonAmount.toLocaleString()} ${CURRENCY}!`);

    return { ...newJackpot, amount: wonAmount };
}


function isJackpotEligible(betAmount) {
    return betAmount >= MIN_BET;
}

async function getJackpotDisplay() {
    const jackpot = await getJackpot();
    return `${jackpot.amount.toLocaleString()} ${CURRENCY}`;
}

async function initJackpot() {
    const jackpot = await db.get('progressive');
    if (!jackpot) {
        await db.set('progressive', { amount: SEED, lastWon: null, lastWinner: null });
        logger.log(`Jackpot initialized at ${SEED} ${CURRENCY}`);
    } else {
        logger.debug(`Jackpot loaded at ${jackpot.amount.toLocaleString()} ${CURRENCY}`);
    }
}

async function addJackpotInterest() {
    const jackpot = await getJackpot();
    const interest = Math.floor(jackpot.amount * (JACKPOT_INTEREST_RATE_PERCENT / 100));
    if (interest > 0) {
        await db.set('progressive', {
            ...jackpot,
            amount: jackpot.amount + interest
        });
        logger.debug(`Jackpot interest added: ${interest} ${CURRENCY}`);
    }
}

module.exports = {
    getJackpot,
    contributeToJackpot,
    winJackpot,
    isJackpotEligible,
    getJackpotDisplay,
    initJackpot,
    addJackpotInterest,
    SEED,
    RATE,
    MIN_BET
};