// Per-guild SQLite store for server-wide stats that don't fit on a user.
// Each guild gets its own `db/guild-<guildId>.sqlite` so guilds don't share
// leaderboards. Keep the schema namespaced (`race.*`, future: `<game>.*`) so
// other games can park their own server-wide aggregates here later.

const { QuickDB } = require("quick.db");
const { withLock } = require("./lock");

const _dbs = new Map();

function getGuildDB(guildId) {
    if (!guildId) throw new Error("getGuildDB requires a guildId");
    let db = _dbs.get(guildId);
    if (!db) {
        db = new QuickDB({ filePath: `./db/guild-${guildId}.sqlite` });
        _dbs.set(guildId, db);
    }
    return db;
}

// Horse aggregates are stored as a single map under `race.horses` keyed by
// horse name. Names contain spaces, which quick.db's dot-path navigation
// can't handle as path segments — so we always read/modify/write the whole
// map under a per-guild lock.
async function applyRaceAggregates(guildId, perHorseDeltas, hallOfFameCandidates) {
    return withLock(`guild:${guildId}`, async () => {
        const db = getGuildDB(guildId);
        const now = Date.now();

        const horses = (await db.get("race.horses")) || {};
        for (const [name, delta] of Object.entries(perHorseDeltas)) {
            const prev = horses[name] || {
                name,
                lastEmoji: delta.emoji,
                lastDisplayOdds: delta.displayOdds,
                bets: 0,
                wagered: 0,
                payouts: 0,
                bettorIds: [],
                lastSeen: 0,
            };
            // Merge new bettor ids into the persistent set so the
            // distinct-bettor count accumulates across races.
            const merged = new Set(prev.bettorIds || []);
            for (const uid of (delta.bettorIds || [])) merged.add(uid);
            horses[name] = {
                name,
                lastEmoji: delta.emoji ?? prev.lastEmoji,
                lastDisplayOdds: delta.displayOdds ?? prev.lastDisplayOdds,
                bets: prev.bets + delta.bets,
                wagered: prev.wagered + delta.wagered,
                payouts: prev.payouts + delta.payouts,
                bettorIds: Array.from(merged),
                lastSeen: now,
            };
        }
        await db.set("race.horses", horses);

        if (hallOfFameCandidates.biggestSingleBet) {
            const current = await db.get("race.biggestSingleBet");
            const candidate = hallOfFameCandidates.biggestSingleBet;
            if (!current || candidate.amount > current.amount) {
                await db.set("race.biggestSingleBet", candidate);
            }
        }
        if (hallOfFameCandidates.biggestSinglePayout) {
            const current = await db.get("race.biggestSinglePayout");
            const candidate = hallOfFameCandidates.biggestSinglePayout;
            if (!current || candidate.amount > current.amount) {
                await db.set("race.biggestSinglePayout", candidate);
            }
        }
    });
}

async function getRaceStats(guildId) {
    const db = getGuildDB(guildId);
    return {
        horses: (await db.get("race.horses")) || {},
        biggestSingleBet: (await db.get("race.biggestSingleBet")) || null,
        biggestSinglePayout: (await db.get("race.biggestSinglePayout")) || null,
    };
}

module.exports = { getGuildDB, applyRaceAggregates, getRaceStats };
