// Per-user async mutex shared by features that mutate balance state
// (duel escrow/payout, craps bet placement, etc.). Used wherever a game
// can interleave with `/bank`, `/slots`, or another concurrent game in
// the same channel and would otherwise risk a double-spend or double-refund.

const _locks = new Map();

async function withUserLock(userId, fn) {
    while (_locks.has(userId)) {
        await _locks.get(userId);
    }
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    _locks.set(userId, promise);
    try {
        return await fn();
    } finally {
        _locks.delete(userId);
        resolve();
    }
}

module.exports = { withUserLock };
