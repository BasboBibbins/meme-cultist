// Per-key async mutex. Single source of truth for serializing async work by
// arbitrary key. Used by chatbot context updates ("thread:<id>", "user:<id>"),
// per-user balance mutation (via withUserLock), and the durable job queue
// ("job:<id>").

// Map stores the tail of the promise chain for each key. Each new caller
// chains onto whatever is currently the tail, so waiters wake one-at-a-time
// (FIFO) instead of all at once when a lock releases.
const _locks = new Map();

async function withLock(key, fn) {
    const prev = _locks.get(key) ?? Promise.resolve();
    let resolve;
    const next = new Promise(r => { resolve = r; });
    _locks.set(key, next);
    await prev;
    try {
        return await fn();
    } finally {
        resolve();
        // Only evict our entry — a later caller may have already queued behind
        // us and replaced the tail with their own promise.
        if (_locks.get(key) === next) {
            _locks.delete(key);
        }
    }
}

module.exports = { withLock };
