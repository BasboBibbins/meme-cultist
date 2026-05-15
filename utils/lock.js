// Per-key async mutex. Single source of truth for serializing async work by
// arbitrary key. Used by chatbot context updates ("thread:<id>", "user:<id>"),
// per-user balance mutation (via withUserLock), and the durable job queue
// ("job:<id>").

const _locks = new Map();

async function withLock(key, fn) {
    while (_locks.has(key)) {
        await _locks.get(key);
    }
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    _locks.set(key, promise);
    try {
        return await fn();
    } finally {
        _locks.delete(key);
        resolve();
    }
}

module.exports = { withLock };
