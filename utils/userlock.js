// Per-user async mutex shared by features that mutate balance state
// (duel escrow/payout, craps bet placement, etc.). Used wherever a game
// can interleave with `/bank`, `/slots`, or another concurrent game in
// the same channel and would otherwise risk a double-spend or double-refund.

const { withLock } = require("./lock");

async function withUserLock(userId, fn) {
    return withLock(`user:${userId}`, fn);
}

module.exports = { withUserLock };
