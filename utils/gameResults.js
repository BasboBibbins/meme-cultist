const path = require("path");
const Database = require("better-sqlite3");
const logger = require("./logger");

let _db = null;
let _insertCount = 0;
const PRUNE_INTERVAL = 100;
const PRUNE_DAYS = 30;

function openDb() {
  if (_db) return _db;
  const dbPath = path.resolve(process.cwd(), "db/game_results.sqlite");
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("busy_timeout = 5000");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS game_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT,
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      game TEXT NOT NULL,
      result_json TEXT NOT NULL,
      played_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gr_lookup ON game_results(user_id, channel_id, played_at);
    CREATE INDEX IF NOT EXISTS idx_gr_channel ON game_results(channel_id, played_at);
    CREATE INDEX IF NOT EXISTS idx_gr_guild ON game_results(guild_id, user_id, played_at);
  `);
  logger.log("[GameResults] Opened db/game_results.sqlite (WAL)");
  return _db;
}

function pruneMaybe() {
  if (++_insertCount % PRUNE_INTERVAL !== 0) return;
  try {
    const cutoff = Date.now() - PRUNE_DAYS * 24 * 60 * 60 * 1000;
    openDb().prepare("DELETE FROM game_results WHERE played_at < ?").run(cutoff);
  } catch (err) {
    logger.warn(`[GameResults] prune failed: ${err.message}`);
  }
}

function recordGameResult({ guildId, channelId, userId, game, result }) {
  if (!channelId || !userId || !game) return;
  try {
    openDb().prepare(
      "INSERT INTO game_results (guild_id, channel_id, user_id, game, result_json, played_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(guildId || null, channelId, userId, game, JSON.stringify(result), Date.now());
    pruneMaybe();
  } catch (err) {
    logger.warn(`[GameResults] record failed: ${err.message}`);
  }
}

function getLatestGameResult({ channelId, userId, game = null }) {
  try {
    const db = openDb();
    const row = game
      ? db.prepare("SELECT * FROM game_results WHERE user_id = ? AND channel_id = ? AND game = ? ORDER BY played_at DESC LIMIT 1").get(userId, channelId, game)
      : db.prepare("SELECT * FROM game_results WHERE user_id = ? AND channel_id = ? ORDER BY played_at DESC LIMIT 1").get(userId, channelId);
    if (!row) return null;
    return { id: row.id, game: row.game, played_at: row.played_at, result: JSON.parse(row.result_json) };
  } catch (err) {
    logger.warn(`[GameResults] getLatest failed: ${err.message}`);
    return null;
  }
}

function getRecentGameResults({ channelId = null, guildId = null, userId = null, game = null, limit = 5 }) {
  if (!channelId && !guildId) return [];
  try {
    const db = openDb();
    const safeLimit = Math.min(Math.max(limit || 5, 1), 20);
    const conditions = [];
    const params = [];
    if (channelId) { conditions.push("channel_id = ?"); params.push(channelId); }
    if (guildId) { conditions.push("guild_id = ?"); params.push(guildId); }
    if (userId) { conditions.push("user_id = ?"); params.push(userId); }
    if (game) { conditions.push("game = ?"); params.push(game); }
    params.push(safeLimit);
    const rows = db.prepare(
      `SELECT * FROM game_results WHERE ${conditions.join(" AND ")} ORDER BY played_at DESC LIMIT ?`
    ).all(...params);
    return rows.map(r => ({ id: r.id, game: r.game, user_id: r.user_id, played_at: r.played_at, result: JSON.parse(r.result_json) }));
  } catch (err) {
    logger.warn(`[GameResults] getRecent failed: ${err.message}`);
    return [];
  }
}

module.exports = { PRUNE_DAYS, recordGameResult, getLatestGameResult, getRecentGameResults };
