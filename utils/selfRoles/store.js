const path = require("path");
const Database = require("better-sqlite3");
const config = require("../../config.js");
const logger = require("../logger");

let _db = null;

function openDb() {
  if (_db) return _db;
  const dbPath = path.resolve(process.cwd(), config.SELF_ROLES_DB_PATH || "db/self_roles.sqlite");
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("busy_timeout = 5000");
  _db.exec(`
        CREATE TABLE IF NOT EXISTS self_roles (
            guild_id TEXT NOT NULL,
            role_id TEXT NOT NULL,
            category TEXT,
            description TEXT,
            added_by TEXT NOT NULL,
            added_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, role_id)
        );
    `);
  logger.log(`[SelfRoles] Opened ${dbPath} (WAL)`);
  return _db;
}

function row(r) {
  if (!r) return null;
  return {
    guildId: r.guild_id,
    roleId: r.role_id,
    category: r.category || null,
    description: r.description || null,
    addedBy: r.added_by,
    addedAt: r.added_at,
  };
}

function listForGuild(guildId) {
  const db = openDb();
  return db.prepare("SELECT * FROM self_roles WHERE guild_id=? ORDER BY added_at ASC, role_id ASC")
    .all(guildId)
    .map(row);
}

function get(guildId, roleId) {
  const db = openDb();
  return row(db.prepare("SELECT * FROM self_roles WHERE guild_id=? AND role_id=?").get(guildId, roleId));
}

// Re-adding a listed role keeps its original added_at, so its place in the form does not move.
function upsert({ guildId, roleId, category = null, description = null, addedBy }) {
  if (!guildId || !roleId || !addedBy) throw new Error("guildId, roleId, addedBy are required.");
  const db = openDb();
  db.prepare(`
        INSERT INTO self_roles (guild_id, role_id, category, description, added_by, added_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, role_id) DO UPDATE SET category=excluded.category, description=excluded.description
    `).run(guildId, roleId, category, description, addedBy, Date.now());
  return get(guildId, roleId);
}

function remove(guildId, roleId) {
  const db = openDb();
  return db.prepare("DELETE FROM self_roles WHERE guild_id=? AND role_id=?").run(guildId, roleId).changes > 0;
}

function removeMany(guildId, roleIds) {
  if (!roleIds.length) return 0;
  const db = openDb();
  const stmt = db.prepare("DELETE FROM self_roles WHERE guild_id=? AND role_id=?");
  const tx = db.transaction(ids => ids.reduce((n, id) => n + stmt.run(guildId, id).changes, 0));
  return tx(roleIds);
}

function close() {
  if (_db) {
    try { _db.close(); } catch (_) {}
    _db = null;
  }
}

module.exports = { listForGuild, get, upsert, remove, removeMany, close };
