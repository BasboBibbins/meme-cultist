// Admin knowledge-base store. Per-guild curated wiki entries with
// embedding-backed semantic search.
//
// Storage: better-sqlite3 in WAL mode (same pattern as personas/store.js).
// Embeddings are 768-dim float32 vectors from Cloudflare bge-base-en-v1.5,
// stored as raw BLOBs. Search is brute-force cosine in JS — fine for <1k
// entries per guild.

const path = require("path");
const Database = require("better-sqlite3");
const config = require("../../config.js");
const logger = require("../logger");
const { withLock } = require("../lock");

let _db = null;

function openDb() {
  if (_db) return _db;
  const dbPath = process.env.KB_TEST_DB || path.resolve(process.cwd(), "db/kb.sqlite");
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("busy_timeout = 5000");
  _db.exec(`
        CREATE TABLE IF NOT EXISTS kb_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            slug TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            tags TEXT,
            embedding BLOB,
            creator_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(guild_id, slug)
        );
        CREATE INDEX IF NOT EXISTS idx_kb_guild ON kb_entries(guild_id);
        CREATE INDEX IF NOT EXISTS idx_kb_slug ON kb_entries(guild_id, slug);
    `);
  logger.log(`[KB] Opened ${dbPath} (WAL)`);
  return _db;
}

function row(r) {
  if (!r) return null;
  return {
    id: r.id,
    guildId: r.guild_id,
    slug: r.slug,
    title: r.title,
    content: r.content,
    tags: r.tags,
    embedding: r.embedding,
    creatorId: r.creator_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function bufferToFloatArray(buf) {
  if (!buf) return null;
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

async function create({ guildId, slug, title, content, tags, creatorId }) {
  return withLock(`kb:${guildId}`, () => {
    if (!guildId || !slug || !title || !content || !creatorId) {
      throw new Error("guildId, slug, title, content, creatorId are required.");
    }
    const db = openDb();
    const now = Date.now();
    const info = db.prepare(`
            INSERT INTO kb_entries (guild_id, slug, title, content, tags, creator_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(guildId, slug, title, content, tags || null, creatorId, now, now);
    return getById(info.lastInsertRowid);
  });
}

async function update({ guildId, slug, title, content, tags }) {
  return withLock(`kb:${guildId}`, () => {
    const db = openDb();
    const current = db.prepare("SELECT * FROM kb_entries WHERE guild_id=? AND slug=?").get(guildId, slug);
    if (!current) return null;
    const next = {
      title: title !== undefined ? title : current.title,
      content: content !== undefined ? content : current.content,
      tags: tags !== undefined ? tags : current.tags,
    };
    db.prepare(`
            UPDATE kb_entries SET title=?, content=?, tags=?, updated_at=?, embedding=NULL
            WHERE guild_id=? AND slug=?
        `).run(next.title, next.content, next.tags, Date.now(), guildId, slug);
    return getBySlug(guildId, slug);
  });
}

function getBySlug(guildId, slug) {
  const db = openDb();
  return row(db.prepare("SELECT * FROM kb_entries WHERE guild_id=? AND slug=?").get(guildId, slug));
}

function getById(id) {
  const db = openDb();
  return row(db.prepare("SELECT * FROM kb_entries WHERE id=?").get(id));
}

function listForGuild(guildId) {
  const db = openDb();
  const rows = db.prepare("SELECT * FROM kb_entries WHERE guild_id=? ORDER BY title ASC").all(guildId);
  return rows.map(row);
}

function deleteBySlug(guildId, slug) {
  const db = openDb();
  const info = db.prepare("DELETE FROM kb_entries WHERE guild_id=? AND slug=?").run(guildId, slug);
  return info.changes > 0;
}

function setEmbedding(guildId, slug, embedding) {
  const db = openDb();
  let buf = null;
  if (embedding) {
    if (Array.isArray(embedding)) {
      buf = Buffer.from(new Float32Array(embedding).buffer);
    } else if (embedding instanceof Float32Array) {
      buf = Buffer.from(embedding.buffer);
    } else if (Buffer.isBuffer(embedding)) {
      buf = embedding;
    } else {
      throw new Error("embedding must be Float32Array, Array, or Buffer");
    }
  }
  const info = db.prepare("UPDATE kb_entries SET embedding=? WHERE guild_id=? AND slug=?").run(buf, guildId, slug);
  return info.changes > 0;
}

function search(guildId, queryEmbedding, limit = 3) {
  const db = openDb();
  const queryVec = queryEmbedding instanceof Float32Array
    ? queryEmbedding
    : new Float32Array(queryEmbedding);

  const rows = db.prepare("SELECT * FROM kb_entries WHERE guild_id=? AND embedding IS NOT NULL").all(guildId);
  const scored = rows.map(r => {
    const entryVec = bufferToFloatArray(r.embedding);
    if (!entryVec || entryVec.length !== queryVec.length) return null;
    return {
      ...row(r),
      score: cosineSimilarity(queryVec, entryVec),
    };
  }).filter(Boolean);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function close() {
  if (_db) {
    try { _db.close(); } catch (_) {}
    _db = null;
  }
}

module.exports = {
  create,
  update,
  getBySlug,
  getById,
  listForGuild,
  deleteBySlug,
  setEmbedding,
  search,
  close,
};
