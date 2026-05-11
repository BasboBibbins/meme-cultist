// Pure game logic for Bubble Craps. No Discord, no canvas, no DB.
// Every game rule lives here; the command handler and canvas legend both
// read BET_DEFINITIONS so the three layers can't drift.

const POINT_NUMBERS = [4, 5, 6, 8, 9, 10];

// True odds payouts for Pass/Come Odds (and inverse for Don't Pass/Come Odds).
const TRUE_ODDS = {
    4:  { num: 2, den: 1 },
    5:  { num: 3, den: 2 },
    6:  { num: 6, den: 5 },
    8:  { num: 6, den: 5 },
    9:  { num: 3, den: 2 },
    10: { num: 2, den: 1 },
};
const LAY_ODDS = {
    4:  { num: 1, den: 2 },
    5:  { num: 2, den: 3 },
    6:  { num: 5, den: 6 },
    8:  { num: 5, den: 6 },
    9:  { num: 2, den: 3 },
    10: { num: 1, den: 2 },
};

const PLACE_PAYOUTS = {
    4:  { num: 9, den: 5 },
    5:  { num: 7, den: 5 },
    6:  { num: 7, den: 6 },
    8:  { num: 7, den: 6 },
    9:  { num: 7, den: 5 },
    10: { num: 9, den: 5 },
};

const HARD_PAYOUTS = {
    4:  { num: 7, den: 1 },
    6:  { num: 9, den: 1 },
    8:  { num: 9, den: 1 },
    10: { num: 7, den: 1 },
};

// Build odds bet definitions for each possible parent point so the BET_DEFINITIONS
// table can be indexed by a single key.
function buildOddsDefs() {
    const out = {};
    for (const p of POINT_NUMBERS) {
        out[`come_odds_${p}`] = {
            category: 'odds', label: `Come Odds (${p})`,
            payout: TRUE_ODDS[p], oneRoll: false,
            allowedBeforePoint: false, allowedAfterPoint: true,
            requiresParent: { key: 'come', cameToPoint: p },
        };
        out[`dontCome_odds_${p}`] = {
            category: 'odds', label: `Don't Come Odds (${p})`,
            payout: LAY_ODDS[p], oneRoll: false,
            allowedBeforePoint: false, allowedAfterPoint: true,
            requiresParent: { key: 'dontCome', cameToPoint: p },
        };
    }
    return out;
}

const BET_DEFINITIONS = {
    // Line bets
    pass: {
        category: 'line', label: 'Pass Line',
        payout: { num: 1, den: 1 }, oneRoll: false,
        allowedBeforePoint: true, allowedAfterPoint: false,
    },
    dontPass: {
        category: 'line', label: "Don't Pass",
        payout: { num: 1, den: 1 }, oneRoll: false,
        allowedBeforePoint: true, allowedAfterPoint: false,
    },
    come: {
        category: 'come', label: 'Come',
        payout: { num: 1, den: 1 }, oneRoll: false,
        allowedBeforePoint: false, allowedAfterPoint: true,
    },
    dontCome: {
        category: 'come', label: "Don't Come",
        payout: { num: 1, den: 1 }, oneRoll: false,
        allowedBeforePoint: false, allowedAfterPoint: true,
    },

    // Odds (require parent)
    pass_odds: {
        category: 'odds', label: 'Pass Odds',
        payout: null, oneRoll: false,
        allowedBeforePoint: false, allowedAfterPoint: true,
        requiresParent: { key: 'pass' },
    },
    dontPass_odds: {
        category: 'odds', label: "Don't Pass Odds",
        payout: null, oneRoll: false,
        allowedBeforePoint: false, allowedAfterPoint: true,
        requiresParent: { key: 'dontPass' },
    },
    ...buildOddsDefs(),

    // Field (one-roll)
    field: {
        category: 'field', label: 'Field',
        payout: { num: 1, den: 1 }, oneRoll: true,
        allowedBeforePoint: true, allowedAfterPoint: true,
    },

    // Place bets
    place_4:  { category: 'place', label: 'Place 4',  payout: PLACE_PAYOUTS[4],  oneRoll: false, allowedBeforePoint: false, allowedAfterPoint: true },
    place_5:  { category: 'place', label: 'Place 5',  payout: PLACE_PAYOUTS[5],  oneRoll: false, allowedBeforePoint: false, allowedAfterPoint: true },
    place_6:  { category: 'place', label: 'Place 6',  payout: PLACE_PAYOUTS[6],  oneRoll: false, allowedBeforePoint: false, allowedAfterPoint: true },
    place_8:  { category: 'place', label: 'Place 8',  payout: PLACE_PAYOUTS[8],  oneRoll: false, allowedBeforePoint: false, allowedAfterPoint: true },
    place_9:  { category: 'place', label: 'Place 9',  payout: PLACE_PAYOUTS[9],  oneRoll: false, allowedBeforePoint: false, allowedAfterPoint: true },
    place_10: { category: 'place', label: 'Place 10', payout: PLACE_PAYOUTS[10], oneRoll: false, allowedBeforePoint: false, allowedAfterPoint: true },

    // Hard ways
    hard_4:  { category: 'hard', label: 'Hard 4',  payout: HARD_PAYOUTS[4],  oneRoll: false, allowedBeforePoint: false, allowedAfterPoint: true },
    hard_6:  { category: 'hard', label: 'Hard 6',  payout: HARD_PAYOUTS[6],  oneRoll: false, allowedBeforePoint: false, allowedAfterPoint: true },
    hard_8:  { category: 'hard', label: 'Hard 8',  payout: HARD_PAYOUTS[8],  oneRoll: false, allowedBeforePoint: false, allowedAfterPoint: true },
    hard_10: { category: 'hard', label: 'Hard 10', payout: HARD_PAYOUTS[10], oneRoll: false, allowedBeforePoint: false, allowedAfterPoint: true },

    // Big 6/8
    big6: { category: 'big', label: 'Big 6', payout: { num: 1, den: 1 }, oneRoll: false, allowedBeforePoint: true, allowedAfterPoint: true },
    big8: { category: 'big', label: 'Big 8', payout: { num: 1, den: 1 }, oneRoll: false, allowedBeforePoint: true, allowedAfterPoint: true },

    // One-roll props
    any7:      { category: 'prop', label: 'Any 7',      payout: { num: 4,  den: 1 }, oneRoll: true, allowedBeforePoint: true, allowedAfterPoint: true },
    anyCraps:  { category: 'prop', label: 'Any Craps',  payout: { num: 7,  den: 1 }, oneRoll: true, allowedBeforePoint: true, allowedAfterPoint: true },
    yo:        { category: 'prop', label: 'Yo (11)',    payout: { num: 15, den: 1 }, oneRoll: true, allowedBeforePoint: true, allowedAfterPoint: true },
    two:       { category: 'prop', label: 'Aces (2)',   payout: { num: 30, den: 1 }, oneRoll: true, allowedBeforePoint: true, allowedAfterPoint: true },
    three:     { category: 'prop', label: 'Ace-Deuce (3)', payout: { num: 15, den: 1 }, oneRoll: true, allowedBeforePoint: true, allowedAfterPoint: true },
    twelve:    { category: 'prop', label: 'Boxcars (12)', payout: { num: 30, den: 1 }, oneRoll: true, allowedBeforePoint: true, allowedAfterPoint: true },
    ce:        { category: 'prop', label: 'C & E',      payout: { num: 0,  den: 1 }, oneRoll: true, allowedBeforePoint: true, allowedAfterPoint: true },
    horn:      { category: 'prop', label: 'Horn',       payout: { num: 0,  den: 1 }, oneRoll: true, allowedBeforePoint: true, allowedAfterPoint: true },
};

function rollDice() {
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const total = d1 + d2;
    return { d1, d2, total, isHard: d1 === d2 && total !== 7 };
}

function establishPoint(total) {
    return POINT_NUMBERS.includes(total) ? total : null;
}

// Floor of stake * num/den. Stakes are integers so this gives integer winnings.
function payoutWinnings(stake, payout) {
    return Math.floor(stake * payout.num / payout.den);
}

// Validate that placing `betKey` is currently legal. The command handler calls
// this before debiting the user.
function validateBetAllowed(betKey, phase, point, existingBets) {
    const def = BET_DEFINITIONS[betKey];
    if (!def) return { allowed: false, reason: 'Unknown bet type.' };

    if (phase === 'comeout' && !def.allowedBeforePoint) {
        return { allowed: false, reason: `${def.label} is only available after a point is set.` };
    }
    if (phase === 'point' && !def.allowedAfterPoint) {
        return { allowed: false, reason: `${def.label} can only be placed before a point is set.` };
    }

    if (def.requiresParent) {
        const parent = existingBets.find(b => {
            if (b.betKey !== def.requiresParent.key) return false;
            if (def.requiresParent.cameToPoint !== undefined) {
                return b.cameToPoint === def.requiresParent.cameToPoint;
            }
            return true;
        });
        if (!parent) {
            return { allowed: false, reason: `${def.label} requires a matching ${def.requiresParent.key} bet first.` };
        }
    }

    // Prevent stacking Place/Hard/Big duplicates — top up by re-placing isn't
    // worth the UX complexity for v1; one bet per slot.
    if (['place', 'hard', 'big', 'odds'].includes(def.category)) {
        if (existingBets.some(b => b.betKey === betKey)) {
            return { allowed: false, reason: `You already have a ${def.label} bet down.` };
        }
    }

    // Come/Don't Come can stack, but only one un-traveled at a time so the
    // next roll resolves predictably.
    if (def.category === 'come') {
        if (existingBets.some(b => b.betKey === betKey && b.cameToPoint == null)) {
            return { allowed: false, reason: `Your ${def.label} bet is still waiting to travel.` };
        }
    }

    return { allowed: true };
}

// Resolve a roll against the standing bets. Returns:
//   results: [{ betKey, originalAmount, status, payoutAmount, remove, movedToPoint? }]
//   newPhase, newPoint
// payoutAmount is what to add to the user's balance (0 on lose, stake on push,
// stake + winnings on win).
function resolveBets(bets, roll, phase, point) {
    const { d1, d2, total, isHard } = roll;
    const results = [];

    let newPhase = phase;
    let newPoint = point;

    // Compute phase transition up front so resolution can branch on the outcome.
    let sevenOut = false;
    let pointHit = false;
    if (phase === 'comeout') {
        if (POINT_NUMBERS.includes(total)) {
            newPhase = 'point';
            newPoint = total;
        }
    } else {
        if (total === 7) {
            sevenOut = true;
            newPhase = 'comeout';
            newPoint = null;
        } else if (total === point) {
            pointHit = true;
            newPhase = 'comeout';
            newPoint = null;
        }
    }

    for (const bet of bets) {
        const def = BET_DEFINITIONS[bet.betKey];
        const stake = bet.amount;
        let status = 'pending';
        let payoutAmount = 0;
        let remove = false;
        let movedToPoint = null;

        if (bet.betKey === 'pass') {
            if (phase === 'comeout') {
                if (total === 7 || total === 11) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, def.payout); remove = true; }
                else if ([2, 3, 12].includes(total)) { status = 'lose'; remove = true; }
                // else: travels to point; bet stays
            } else {
                if (pointHit) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, def.payout); remove = true; }
                else if (sevenOut) { status = 'lose'; remove = true; }
            }
        } else if (bet.betKey === 'dontPass') {
            if (phase === 'comeout') {
                if (total === 2 || total === 3) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, def.payout); remove = true; }
                else if (total === 12) { status = 'push'; payoutAmount = stake; remove = true; }
                else if (total === 7 || total === 11) { status = 'lose'; remove = true; }
                // else: travels
            } else {
                if (sevenOut) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, def.payout); remove = true; }
                else if (pointHit) { status = 'lose'; remove = true; }
            }
        } else if (bet.betKey === 'come') {
            if (bet.cameToPoint == null) {
                // First roll after placement — acts like Pass come-out for this bet.
                if (total === 7 || total === 11) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, def.payout); remove = true; }
                else if ([2, 3, 12].includes(total)) { status = 'lose'; remove = true; }
                else if (POINT_NUMBERS.includes(total)) { movedToPoint = total; }
            } else {
                if (total === bet.cameToPoint) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, def.payout); remove = true; }
                else if (total === 7) { status = 'lose'; remove = true; }
            }
        } else if (bet.betKey === 'dontCome') {
            if (bet.cameToPoint == null) {
                if (total === 2 || total === 3) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, def.payout); remove = true; }
                else if (total === 12) { status = 'push'; payoutAmount = stake; remove = true; }
                else if (total === 7 || total === 11) { status = 'lose'; remove = true; }
                else if (POINT_NUMBERS.includes(total)) { movedToPoint = total; }
            } else {
                if (total === 7) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, def.payout); remove = true; }
                else if (total === bet.cameToPoint) { status = 'lose'; remove = true; }
            }
        } else if (bet.betKey === 'pass_odds') {
            // Resolves with parent Pass on point hit / 7-out.
            if (phase === 'point') {
                if (pointHit) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, TRUE_ODDS[point]); remove = true; }
                else if (sevenOut) { status = 'lose'; remove = true; }
            }
        } else if (bet.betKey === 'dontPass_odds') {
            if (phase === 'point') {
                if (sevenOut) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, LAY_ODDS[point]); remove = true; }
                else if (pointHit) { status = 'lose'; remove = true; }
            }
        } else if (def && def.category === 'odds' && bet.betKey.startsWith('come_odds_')) {
            // Resolves with its parent Come bet that has traveled to this number.
            const targetPoint = Number(bet.betKey.replace('come_odds_', ''));
            if (total === targetPoint) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, TRUE_ODDS[targetPoint]); remove = true; }
            else if (total === 7) { status = 'lose'; remove = true; }
        } else if (def && def.category === 'odds' && bet.betKey.startsWith('dontCome_odds_')) {
            const targetPoint = Number(bet.betKey.replace('dontCome_odds_', ''));
            if (total === 7) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, LAY_ODDS[targetPoint]); remove = true; }
            else if (total === targetPoint) { status = 'lose'; remove = true; }
        } else if (bet.betKey === 'field') {
            // One-roll.
            if (total === 2) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, { num: 2, den: 1 }); remove = true; }
            else if (total === 12) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, { num: 3, den: 1 }); remove = true; }
            else if ([3, 4, 9, 10, 11].includes(total)) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, { num: 1, den: 1 }); remove = true; }
            else { status = 'lose'; remove = true; }
        } else if (def && def.category === 'place') {
            const placeNum = Number(bet.betKey.replace('place_', ''));
            if (total === 7) { status = 'lose'; remove = true; }
            else if (total === placeNum) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, PLACE_PAYOUTS[placeNum]); remove = true; }
        } else if (def && def.category === 'hard') {
            const hardNum = Number(bet.betKey.replace('hard_', ''));
            if (total === 7) { status = 'lose'; remove = true; }
            else if (total === hardNum) {
                if (isHard) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, HARD_PAYOUTS[hardNum]); remove = true; }
                else { status = 'lose'; remove = true; }
            }
        } else if (bet.betKey === 'big6') {
            if (total === 7) { status = 'lose'; remove = true; }
            else if (total === 6) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, { num: 1, den: 1 }); remove = true; }
        } else if (bet.betKey === 'big8') {
            if (total === 7) { status = 'lose'; remove = true; }
            else if (total === 8) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, { num: 1, den: 1 }); remove = true; }
        } else if (bet.betKey === 'any7') {
            if (total === 7) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, { num: 4, den: 1 }); }
            else { status = 'lose'; }
            remove = true;
        } else if (bet.betKey === 'anyCraps') {
            if ([2, 3, 12].includes(total)) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, { num: 7, den: 1 }); }
            else { status = 'lose'; }
            remove = true;
        } else if (bet.betKey === 'yo') {
            if (total === 11) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, { num: 15, den: 1 }); }
            else { status = 'lose'; }
            remove = true;
        } else if (bet.betKey === 'two') {
            if (total === 2) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, { num: 30, den: 1 }); }
            else { status = 'lose'; }
            remove = true;
        } else if (bet.betKey === 'three') {
            if (total === 3) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, { num: 15, den: 1 }); }
            else { status = 'lose'; }
            remove = true;
        } else if (bet.betKey === 'twelve') {
            if (total === 12) { status = 'win'; payoutAmount = stake + payoutWinnings(stake, { num: 30, den: 1 }); }
            else { status = 'lose'; }
            remove = true;
        } else if (bet.betKey === 'ce') {
            // C&E = half stake on Any Craps (7:1 on craps numbers), half on Yo (15:1 on 11).
            // Pays out on the relevant side; full stake lost otherwise.
            const half = Math.floor(stake / 2);
            const crapsHalf = stake - half; // covers odd-stake parity
            if ([2, 3, 12].includes(total)) { status = 'win'; payoutAmount = crapsHalf + payoutWinnings(crapsHalf, { num: 7, den: 1 }); }
            else if (total === 11) { status = 'win'; payoutAmount = half + payoutWinnings(half, { num: 15, den: 1 }); }
            else { status = 'lose'; }
            remove = true;
        } else if (bet.betKey === 'horn') {
            // Horn = stake split four ways across 2/3/11/12. Pays the relevant
            // per-number payout on a hit; rest is lost.
            const part = Math.floor(stake / 4);
            if (total === 2) { status = 'win'; payoutAmount = part + payoutWinnings(part, { num: 30, den: 1 }); remove = true; }
            else if (total === 3) { status = 'win'; payoutAmount = part + payoutWinnings(part, { num: 15, den: 1 }); remove = true; }
            else if (total === 11) { status = 'win'; payoutAmount = part + payoutWinnings(part, { num: 15, den: 1 }); remove = true; }
            else if (total === 12) { status = 'win'; payoutAmount = part + payoutWinnings(part, { num: 30, den: 1 }); remove = true; }
            else { status = 'lose'; remove = true; }
        }

        results.push({
            betKey: bet.betKey,
            originalAmount: stake,
            status,
            payoutAmount,
            remove,
            movedToPoint,
            cameToPoint: bet.cameToPoint ?? null,
        });
    }

    return { results, newPhase, newPoint };
}

// Convenience: list bet keys grouped by category for the UI select menus.
function betsByCategory() {
    const grouped = {};
    for (const [key, def] of Object.entries(BET_DEFINITIONS)) {
        if (!grouped[def.category]) grouped[def.category] = [];
        grouped[def.category].push({ key, ...def });
    }
    return grouped;
}

module.exports = {
    BET_DEFINITIONS,
    POINT_NUMBERS,
    TRUE_ODDS,
    LAY_ODDS,
    PLACE_PAYOUTS,
    HARD_PAYOUTS,
    rollDice,
    establishPoint,
    validateBetAllowed,
    resolveBets,
    betsByCategory,
    payoutWinnings,
};
