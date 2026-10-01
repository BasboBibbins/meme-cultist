const path = require("path");
const Database = require("better-sqlite3");
const config = require("../config.js");
const logger = require("./logger");

let _db = null;

function openDb() {
  if (_db) return _db;
  const dbPath = path.resolve(process.cwd(), config.PRANK_DB_PATH || "db/pranks.sqlite");
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("busy_timeout = 5000");
  _db.exec(`
        CREATE TABLE IF NOT EXISTS possessions (
            user_id TEXT PRIMARY KEY,
            expires_at INTEGER NOT NULL
        );
    `);
  logger.log(`[Pranks] Opened ${dbPath} (WAL)`);
  return _db;
}

function savePossession(userId, expiresAt) {
  openDb()
    .prepare("INSERT INTO possessions (user_id, expires_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET expires_at = excluded.expires_at")
    .run(userId, expiresAt);
}

function clearPossession(userId) {
  openDb().prepare("DELETE FROM possessions WHERE user_id = ?").run(userId);
}

function loadActivePossessions(now = Date.now()) {
  const db = openDb();
  db.prepare("DELETE FROM possessions WHERE expires_at <= ?").run(now);
  return db.prepare("SELECT user_id, expires_at FROM possessions").all()
    .map(r => ({ userId: r.user_id, expiresAt: r.expires_at }));
}

module.exports = { savePossession, clearPossession, loadActivePossessions };
