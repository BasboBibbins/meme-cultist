// Persistent named personas, scoped per guild. A persona is a reusable
// system-prompt fragment that any thread or channel can pin to override the
// bot's default voice. Storage is better-sqlite3 in WAL mode — same pattern
// as utils/jobs/queue.js.
//
// This module only exposes CRUD + lookup. Integration with handleBotMessage
// lives in utils/openai.js.

const path = require("path");
const Database = require("better-sqlite3");
const config = require("../../config.js");
const logger = require("../logger");

let _db = null;

function openDb() {
  if (_db) return _db;
  const dbPath = path.resolve(process.cwd(), config.PERSONA_DB_PATH || "db/personas.sqlite");
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("busy_timeout = 5000");
  _db.exec(`
        CREATE TABLE IF NOT EXISTS personas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            name TEXT NOT NULL,
            system_prompt TEXT NOT NULL,
            creator_id TEXT NOT NULL,
            is_public INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(guild_id, name)
        );
        CREATE INDEX IF NOT EXISTS idx_personas_guild ON personas(guild_id);
    `);
  logger.log(`[Personas] Opened ${dbPath} (WAL)`);
  return _db;
}

function row(r) {
  if (!r) return null;
  return {
    id: r.id,
    guildId: r.guild_id,
    name: r.name,
    systemPrompt: r.system_prompt,
    creatorId: r.creator_id,
    isPublic: !!r.is_public,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function create({ guildId, name, systemPrompt, creatorId, isPublic = true }) {
  if (!guildId || !name || !systemPrompt || !creatorId) {
    throw new Error("guildId, name, systemPrompt, creatorId are required.");
  }
  const db = openDb();
  const now = Date.now();
  const info = db.prepare(`
        INSERT INTO personas (guild_id, name, system_prompt, creator_id, is_public, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(guildId, name, systemPrompt, creatorId, isPublic ? 1 : 0, now, now);
  return getById(info.lastInsertRowid);
}

function update(id, patch) {
  const db = openDb();
  const current = db.prepare("SELECT * FROM personas WHERE id=?").get(id);
  if (!current) return null;
  const next = {
    system_prompt: patch.systemPrompt !== undefined ? patch.systemPrompt : current.system_prompt,
    is_public: patch.isPublic !== undefined ? (patch.isPublic ? 1 : 0) : current.is_public,
  };
  db.prepare("UPDATE personas SET system_prompt=?, is_public=?, updated_at=? WHERE id=?")
    .run(next.system_prompt, next.is_public, Date.now(), id);
  return getById(id);
}

function getByName(guildId, name) {
  const db = openDb();
  return row(db.prepare("SELECT * FROM personas WHERE guild_id=? AND name=?").get(guildId, name));
}

function getById(id) {
  const db = openDb();
  return row(db.prepare("SELECT * FROM personas WHERE id=?").get(id));
}

function listForGuild(guildId) {
  const db = openDb();
  const rows = db.prepare("SELECT * FROM personas WHERE guild_id=? ORDER BY name ASC").all(guildId);
  return rows.map(row);
}

function deleteById(id) {
  const db = openDb();
  const info = db.prepare("DELETE FROM personas WHERE id=?").run(id);
  return info.changes > 0;
}

function close() {
  if (_db) {
    try { _db.close(); } catch (_) {}
    _db = null;
  }
}

module.exports = { create, update, getByName, getById, listForGuild, deleteById, close };
