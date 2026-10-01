const path = require("path");
const Database = require("better-sqlite3");
const config = require("../../config.js");
const logger = require("../logger");

let _db = null;

function openDb() {
  if (_db) return _db;
  const dbPath = path.resolve(process.cwd(), config.WEB_SEARCH_DB_PATH || "db/web_search.sqlite");
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("busy_timeout = 5000");
  _db.exec(`
        CREATE TABLE IF NOT EXISTS usage (
            day TEXT PRIMARY KEY,
            count INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    `);
  logger.log(`[WebSearchBudget] Opened ${dbPath} (WAL)`);
  return _db;
}

function dayCount(day) {
  return openDb().prepare("SELECT count FROM usage WHERE day = ?").get(day)?.count ?? 0;
}

function monthCount(month) {
  return openDb().prepare("SELECT COALESCE(SUM(count), 0) AS total FROM usage WHERE day LIKE ?").get(`${month}-%`).total;
}

function adjustDay(day, delta) {
  openDb()
    .prepare("INSERT INTO usage (day, count) VALUES (?, MAX(?, 0)) ON CONFLICT(day) DO UPDATE SET count = MAX(count + ?, 0)")
    .run(day, delta, delta);
}

function getState(key) {
  const row = openDb().prepare("SELECT value FROM state WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : null;
}

function setState(key, value) {
  openDb()
    .prepare("INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, JSON.stringify(value));
}

module.exports = { dayCount, monthCount, adjustDay, getState, setState };
