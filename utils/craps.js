// Pure game logic for Street Craps. No Discord, no canvas, no DB.
// Five-bet surface: pass, dontPass, field, any7, anyCraps. The command handler
// and canvas legend both read BET_DEFINITIONS so the layers can't drift.

const POINT_NUMBERS = [4, 5, 6, 8, 9, 10];

const BET_DEFINITIONS = {
    pass: {
        category: "line", label: "Pass Line",
        payout: { num: 1, den: 1 }, oneRoll: false,
        allowedBeforePoint: true, allowedAfterPoint: false,
    },
    dontPass: {
        category: "line", label: "Don't Pass",
        payout: { num: 1, den: 1 }, oneRoll: false,
        allowedBeforePoint: true, allowedAfterPoint: false,
    },
    field: {
        category: "oneRoll", label: "Field",
        payout: { num: 1, den: 1 }, oneRoll: true,
        allowedBeforePoint: true, allowedAfterPoint: true,
    },
    any7: {
        category: "oneRoll", label: "Any 7",
        payout: { num: 4, den: 1 }, oneRoll: true,
        allowedBeforePoint: true, allowedAfterPoint: true,
    },
    anyCraps: {
        category: "oneRoll", label: "Any Craps",
        payout: { num: 7, den: 1 }, oneRoll: true,
        allowedBeforePoint: true, allowedAfterPoint: true,
    },
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

function payoutWinnings(stake, payout) {
    return Math.floor(stake * payout.num / payout.den);
}

function validateBetAllowed(betKey, phase, point, existingBets) {
    const def = BET_DEFINITIONS[betKey];
    if (!def) return { allowed: false, reason: "Unknown bet type." };

    if (phase === "comeout" && !def.allowedBeforePoint) {
        return { allowed: false, reason: `${def.label} is only available after a point is set.` };
    }
    if (phase === "point" && !def.allowedAfterPoint) {
        return { allowed: false, reason: `${def.label} can only be placed before a point is set.` };
    }

    return { allowed: true };
}

// Resolve a roll against the standing bets. Returns:
//   results: [{ betKey, originalAmount, status, payoutAmount, remove }]
//   newPhase, newPoint
// payoutAmount is what to add to the user's balance (0 on lose, stake on push,
// stake + winnings on win).
function resolveBets(bets, roll, phase, point) {
    const { total } = roll;
    const results = [];

    let newPhase = phase;
    let newPoint = point;

    let sevenOut = false;
    let pointHit = false;
    if (phase === "comeout") {
        if (POINT_NUMBERS.includes(total)) {
            newPhase = "point";
            newPoint = total;
        }
    } else {
        if (total === 7) {
            sevenOut = true;
            newPhase = "comeout";
            newPoint = null;
        } else if (total === point) {
            pointHit = true;
            newPhase = "comeout";
            newPoint = null;
        }
    }

    for (const bet of bets) {
        const def = BET_DEFINITIONS[bet.betKey];
        const stake = bet.amount;
        let status = "pending";
        let payoutAmount = 0;
        let remove = false;

        if (bet.betKey === "pass") {
            if (phase === "comeout") {
                if (total === 7 || total === 11) { status = "win"; payoutAmount = stake + payoutWinnings(stake, def.payout); remove = true; }
                else if ([2, 3, 12].includes(total)) { status = "lose"; remove = true; }
            } else {
                if (pointHit) { status = "win"; payoutAmount = stake + payoutWinnings(stake, def.payout); remove = true; }
                else if (sevenOut) { status = "lose"; remove = true; }
            }
        } else if (bet.betKey === "dontPass") {
            if (phase === "comeout") {
                if (total === 2 || total === 3) { status = "win"; payoutAmount = stake + payoutWinnings(stake, def.payout); remove = true; }
                else if (total === 12) { status = "push"; payoutAmount = stake; remove = true; }
                else if (total === 7 || total === 11) { status = "lose"; remove = true; }
            } else {
                if (sevenOut) { status = "win"; payoutAmount = stake + payoutWinnings(stake, def.payout); remove = true; }
                else if (pointHit) { status = "lose"; remove = true; }
            }
        } else if (bet.betKey === "field") {
            if (total === 2) { status = "win"; payoutAmount = stake + payoutWinnings(stake, { num: 2, den: 1 }); }
            else if (total === 12) { status = "win"; payoutAmount = stake + payoutWinnings(stake, { num: 3, den: 1 }); }
            else if ([3, 4, 9, 10, 11].includes(total)) { status = "win"; payoutAmount = stake + payoutWinnings(stake, { num: 1, den: 1 }); }
            else { status = "lose"; }
            remove = true;
        } else if (bet.betKey === "any7") {
            if (total === 7) { status = "win"; payoutAmount = stake + payoutWinnings(stake, def.payout); }
            else { status = "lose"; }
            remove = true;
        } else if (bet.betKey === "anyCraps") {
            if ([2, 3, 12].includes(total)) { status = "win"; payoutAmount = stake + payoutWinnings(stake, def.payout); }
            else { status = "lose"; }
            remove = true;
        }

        results.push({
            betKey: bet.betKey,
            originalAmount: stake,
            status,
            payoutAmount,
            remove,
        });
    }

    return { results, newPhase, newPoint, sevenOut, pointHit };
}

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
    rollDice,
    establishPoint,
    validateBetAllowed,
    resolveBets,
    betsByCategory,
    payoutWinnings,
};
