// Episodic memory store. Episodes capture specific past events ("On 2026-05-04
// basbo hit a 100k jackpot") distinct from stable semantic facts. They are
// retrieved on demand via recall_episode rather than always loaded into the
// prompt, keeping the per-turn token budget stable.
//
// Storage: better-sqlite3 WAL (same pattern as kb/store.js and
// messageArchive/store.js). Embeddings are 768-dim float32 vectors via
// Cloudflare bge-base-en-v1.5, stored as BLOBs. Cosine search is brute-force
// in JS — fine for <=100 episodes per scope.
//
// Episodes are capped at MAX_EPISODES_PER_SCOPE per (scope_type, scope_id).
// Oldest entries are pruned on each insert that would exceed the cap.

const path = require("path");
const Database = require("better-sqlite3");
const logger = require("../logger");

const MAX_EPISODES_PER_SCOPE = 100;

let _db = null;

function openDb() {
  if (_db) return _db;
  const dbPath = process.env.EPISODES_TEST_DB || path.resolve(process.cwd(), "db/episodes.sqlite");
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("busy_timeout = 5000");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS episodes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_type  TEXT    NOT NULL,
      scope_id    TEXT    NOT NULL,
      summary     TEXT    NOT NULL,
      embedding   BLOB,
      tags        TEXT,
      source      TEXT    NOT NULL DEFAULT 'manual',
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ep_scope ON episodes(scope_type, scope_id);
    CREATE INDEX IF NOT EXISTS idx_ep_created ON episodes(scope_type, scope_id, created_at);
  `);
  try {
    _db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(
        summary,
        scope_type UNINDEXED,
        scope_id   UNINDEXED,
        content_rowid=id
      );
    `);
  } catch (err) {
    logger.warn(`[Episodes] FTS5 init: ${err.message}`);
  }
  logger.log(`[Episodes] Opened ${dbPath} (WAL)`);
  return _db;
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
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

// Prune oldest episodes when a scope exceeds the cap. Called inside the same
// write transaction as insertEpisode so the cap is always enforced atomically.
function _pruneScope(db, scopeType, scopeId) {
  const count = db.prepare(
    "SELECT COUNT(*) AS c FROM episodes WHERE scope_type=? AND scope_id=?"
  ).get(scopeType, scopeId).c;
  if (count <= MAX_EPISODES_PER_SCOPE) return;
  const toDrop = count - MAX_EPISODES_PER_SCOPE;
  const ids = db.prepare(
    "SELECT id FROM episodes WHERE scope_type=? AND scope_id=? ORDER BY created_at ASC LIMIT ?"
  ).all(scopeType, scopeId, toDrop).map(r => r.id);
  if (ids.length === 0) return;
  const ph = ids.map(() => "?").join(",");
  try { db.prepare(`DELETE FROM episodes_fts WHERE rowid IN (${ph})`).run(...ids); }
  catch (err) { logger.warn(`[Episodes] FTS prune failed: ${err.message}`); }
  db.prepare(`DELETE FROM episodes WHERE id IN (${ph})`).run(...ids);
  logger.debug(`[Episodes] Pruned ${ids.length} oldest episodes from ${scopeType}:${scopeId}`);
}

// Add a new episode. Returns the inserted row id, or null on failure.
// Caller should enqueue an 'episode_embed' job after this returns.
function addEpisode({ scopeType, scopeId, summary, tags = [], source = "manual" }) {
  if (!scopeType || !scopeId || !summary) throw new Error("scopeType, scopeId, summary are required");
  const db = openDb();
  const tagsJson = Array.isArray(tags) ? JSON.stringify(tags) : (tags || "[]");
  const now = Date.now();
  const insertAndPrune = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO episodes (scope_type, scope_id, summary, tags, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(scopeType, scopeId, summary, tagsJson, source, now);
    const rowid = info.lastInsertRowid;
    try {
      db.prepare(
        "INSERT INTO episodes_fts (rowid, summary, scope_type, scope_id) VALUES (?, ?, ?, ?)"
      ).run(rowid, summary, scopeType, scopeId);
    } catch (err) {
      logger.warn(`[Episodes] FTS5 insert failed: ${err.message}`);
    }
    _pruneScope(db, scopeType, scopeId);
    return rowid;
  });
  return insertAndPrune();
}

function getUnembeddedAny(limit = 100) {
  const db = openDb();
  return db.prepare(
    "SELECT id, summary, scope_type, scope_id FROM episodes WHERE embedding IS NULL ORDER BY created_at ASC LIMIT ?"
  ).all(limit);
}

// Fetch specific episodes (id, summary) that still need an embedding, by id.
// Used by the episode_embed job to embed exactly the rows it was enqueued for,
// rather than scanning the oldest-N unembedded window (which silently skips a
// freshly-created episode once the backlog exceeds that window).
function getByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const db = openDb();
  const ph = ids.map(() => "?").join(",");
  return db.prepare(
    `SELECT id, summary FROM episodes WHERE id IN (${ph}) AND embedding IS NULL`
  ).all(...ids);
}

function setEmbedding(id, embedding) {
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
  return db.prepare("UPDATE episodes SET embedding=? WHERE id=?").run(buf, id).changes > 0;
}

// FTS keyword search across one or more (scopeType, scopeId) pairs.
// scopePairs is an array of { scopeType, scopeId } objects.
function searchFTS(scopePairs, query, limit = 30) {
  const db = openDb();
  try {
    // Build WHERE clause for the scope pairs
    const scopeConditions = scopePairs.map(() => "(mc.scope_type=? AND mc.scope_id=?)").join(" OR ");
    const scopeParams = scopePairs.flatMap(p => [p.scopeType, p.scopeId]);
    const rows = db.prepare(`
      SELECT mc.id, mc.scope_type, mc.scope_id, mc.summary, mc.tags, mc.source, mc.created_at, rank
      FROM episodes_fts
      JOIN episodes mc ON mc.id = episodes_fts.rowid
      WHERE episodes_fts MATCH ? AND (${scopeConditions})
      ORDER BY rank
      LIMIT ?
    `).all(query, ...scopeParams, limit);
    return rows;
  } catch (err) {
    logger.warn(`[Episodes] FTS search failed: ${err.message}`);
    return [];
  }
}

// Semantic search over a set of candidate IDs (from FTS re-rank).
function searchSemantic(queryEmbedding, candidateIds, limit = 5) {
  const db = openDb();
  if (!candidateIds || candidateIds.length === 0) return [];
  const queryVec = queryEmbedding instanceof Float32Array ? queryEmbedding : new Float32Array(queryEmbedding);
  const ph = candidateIds.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT * FROM episodes WHERE id IN (${ph}) AND embedding IS NOT NULL`
  ).all(...candidateIds);
  const scored = rows.map(r => {
    const vec = bufferToFloatArray(r.embedding);
    if (!vec || vec.length !== queryVec.length) return null;
    const score = cosineSimilarity(queryVec, vec);
    // A zero/degenerate embedding yields NaN (dot/0); NaN would survive here and
    // corrupt the sort, so drop non-finite scores.
    return Number.isFinite(score) ? { ...r, score } : null;
  }).filter(Boolean);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// Full semantic scan across scope pairs when FTS returns nothing.
function searchSemanticFull(scopePairs, queryEmbedding, limit = 5) {
  const db = openDb();
  const queryVec = queryEmbedding instanceof Float32Array ? queryEmbedding : new Float32Array(queryEmbedding);
  const scopeConditions = scopePairs.map(() => "(scope_type=? AND scope_id=?)").join(" OR ");
  const scopeParams = scopePairs.flatMap(p => [p.scopeType, p.scopeId]);
  const rows = db.prepare(
    `SELECT * FROM episodes WHERE (${scopeConditions}) AND embedding IS NOT NULL ORDER BY created_at DESC LIMIT 500`
  ).all(...scopeParams);
  const scored = rows.map(r => {
    const vec = bufferToFloatArray(r.embedding);
    if (!vec || vec.length !== queryVec.length) return null;
    const score = cosineSimilarity(queryVec, vec);
    return Number.isFinite(score) ? { ...r, score } : null;
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
  addEpisode,
  getUnembeddedAny,
  getByIds,
  setEmbedding,
  searchFTS,
  searchSemantic,
  searchSemanticFull,
  close,
  MAX_EPISODES_PER_SCOPE,
};
