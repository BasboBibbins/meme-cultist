// Message archive for reduced-write RAG. Stores message chunks with FTS5
// full-text index and optional embedding blobs for semantic re-ranking.
//
// Ingestion writes on every message (lightweight INSERT OR IGNORE) but
// embedding jobs are only enqueued at summary boundaries (~ every 25
// messages) to keep API costs and SD-card wear low.

const path = require("path");
const Database = require("better-sqlite3");
const logger = require("../logger");

let _db = null;

function openDb() {
  if (_db) return _db;
  const dbPath = process.env.ARCHIVE_TEST_DB || path.resolve(process.cwd(), "db/message_archive.sqlite");
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("busy_timeout = 5000");
  _db.exec(`
        CREATE TABLE IF NOT EXISTS message_chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel_id TEXT NOT NULL,
            message_id TEXT NOT NULL,
            author_id TEXT NOT NULL,
            content TEXT NOT NULL,
            chunk_index INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            embedding BLOB
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_id ON message_chunks(message_id, chunk_index);
        CREATE INDEX IF NOT EXISTS idx_msg_channel ON message_chunks(channel_id);
    `);
  try {
    _db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS message_chunks_fts USING fts5(
                content,
                channel_id UNINDEXED,
                content_rowid=id
            );
        `);
  } catch (err) {
    logger.warn(`[MessageArchive] FTS5 init: ${err.message}`);
  }
  logger.log(`[MessageArchive] Opened ${dbPath} (WAL)`);
  return _db;
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

function insertChunk({ channelId, messageId, authorId, content, chunkIndex = 0, createdAt }) {
  const db = openDb();
  const info = db.prepare(`
        INSERT OR IGNORE INTO message_chunks (channel_id, message_id, author_id, content, chunk_index, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(channelId, messageId, authorId, content, chunkIndex, createdAt);
  if (info.changes > 0) {
    try {
      db.prepare("INSERT INTO message_chunks_fts (rowid, content, channel_id) VALUES (?, ?, ?)")
        .run(info.lastInsertRowid, content, channelId);
    } catch (err) {
      logger.warn(`[MessageArchive] FTS5 insert failed: ${err.message}`);
    }
  }
  return info.changes > 0 ? info.lastInsertRowid : null;
}

function searchFTS(channelId, query, limit = 30) {
  const db = openDb();
  try {
    const rows = db.prepare(`
            SELECT mc.id, mc.channel_id, mc.message_id, mc.author_id, mc.content, mc.created_at,
                   rank
            FROM message_chunks_fts
            JOIN message_chunks mc ON mc.id = message_chunks_fts.rowid
            WHERE message_chunks_fts MATCH ? AND mc.channel_id = ?
            ORDER BY rank
            LIMIT ?
        `).all(query, channelId, limit);
    return rows;
  } catch (err) {
    logger.warn(`[MessageArchive] FTS5 search failed: ${err.message}`);
    return [];
  }
}

function searchSemantic(channelId, queryEmbedding, candidateIds, limit = 5) {
  const db = openDb();
  const queryVec = queryEmbedding instanceof Float32Array ? queryEmbedding : new Float32Array(queryEmbedding);
  if (!candidateIds || candidateIds.length === 0) return [];

  const placeholders = candidateIds.map(() => "?").join(",");
  const rows = db.prepare(`
        SELECT * FROM message_chunks
        WHERE channel_id = ? AND id IN (${placeholders}) AND embedding IS NOT NULL
    `).all(channelId, ...candidateIds);

  const scored = rows.map(r => {
    const vec = bufferToFloatArray(r.embedding);
    if (!vec || vec.length !== queryVec.length) return null;
    return { ...r, score: cosineSimilarity(queryVec, vec) };
  }).filter(Boolean);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function searchSemanticFull(channelId, queryEmbedding, limit = 5) {
  const db = openDb();
  const queryVec = queryEmbedding instanceof Float32Array
    ? queryEmbedding : new Float32Array(queryEmbedding);
  const rows = db.prepare(
    "SELECT * FROM message_chunks WHERE channel_id = ? AND embedding IS NOT NULL ORDER BY created_at DESC LIMIT 500"
  ).all(channelId);
  const scored = rows.map(r => {
    const vec = bufferToFloatArray(r.embedding);
    if (!vec || vec.length !== queryVec.length) return null;
    return { ...r, score: cosineSimilarity(queryVec, vec) };
  }).filter(Boolean);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function getUnembeddedForChannel(channelId, limit = 100) {
  const db = openDb();
  return db.prepare(`
        SELECT id, content FROM message_chunks
        WHERE channel_id = ? AND embedding IS NULL
        ORDER BY created_at ASC
        LIMIT ?
    `).all(channelId, limit);
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
  const info = db.prepare("UPDATE message_chunks SET embedding = ? WHERE id = ?").run(buf, id);
  return info.changes > 0;
}

function getMaxMessageIdForChannel(channelId) {
  const db = openDb();
  const row = db.prepare("SELECT MAX(message_id) AS max_id FROM message_chunks WHERE channel_id = ?").get(channelId);
  return row?.max_id || null;
}

function countForChannel(channelId) {
  const db = openDb();
  const row = db.prepare("SELECT COUNT(*) AS c FROM message_chunks WHERE channel_id = ?").get(channelId);
  return row?.c || 0;
}

function close() {
  if (_db) {
    try { _db.close(); } catch (_) {}
    _db = null;
  }
}

// Retention: drop rows older than `retentionDays`, then trim each channel's
// remaining rows to at most `maxRowsPerChannel`. Either can be zero/falsy to
// skip that stage. Returns a summary so the scheduled caller can log it.
//
// SD-card-class hosts cannot grow this archive forever; a Pi 3B with a 16 GB
// card and ~500 messages/day across 5 chatbot channels would crowd out the
// rest of the data directory within ~3 months at full retention. The dual
// (TTL + per-channel cap) approach makes both axes bounded.
function prune({ retentionDays = 0, maxRowsPerChannel = 0 } = {}) {
  const db = openDb();
  let deletedByAge = 0;
  let deletedByCap = 0;

  if (retentionDays > 0) {
    const cutoff = Date.now() - retentionDays * 86400000;
    const oldIds = db.prepare("SELECT id FROM message_chunks WHERE created_at < ?").all(cutoff).map(r => r.id);
    if (oldIds.length > 0) {
      const placeholders = oldIds.map(() => "?").join(",");
      // FTS5 contentless table is content_rowid-linked; deleting from the
      // base table does not auto-delete the FTS row, so do both.
      try { db.prepare(`DELETE FROM message_chunks_fts WHERE rowid IN (${placeholders})`).run(...oldIds); }
      catch (err) { logger.warn(`[MessageArchive] FTS prune (age) failed: ${err.message}`); }
      const info = db.prepare(`DELETE FROM message_chunks WHERE id IN (${placeholders})`).run(...oldIds);
      deletedByAge = info.changes;
    }
  }

  if (maxRowsPerChannel > 0) {
    const channels = db.prepare("SELECT DISTINCT channel_id FROM message_chunks").all();
    for (const { channel_id } of channels) {
      const count = db.prepare("SELECT COUNT(*) AS c FROM message_chunks WHERE channel_id = ?").get(channel_id).c;
      if (count <= maxRowsPerChannel) continue;
      const toDrop = count - maxRowsPerChannel;
      const ids = db.prepare("SELECT id FROM message_chunks WHERE channel_id = ? ORDER BY created_at ASC LIMIT ?").all(channel_id, toDrop).map(r => r.id);
      if (ids.length === 0) continue;
      const placeholders = ids.map(() => "?").join(",");
      try { db.prepare(`DELETE FROM message_chunks_fts WHERE rowid IN (${placeholders})`).run(...ids); }
      catch (err) { logger.warn(`[MessageArchive] FTS prune (cap) failed: ${err.message}`); }
      const info = db.prepare(`DELETE FROM message_chunks WHERE id IN (${placeholders})`).run(...ids);
      deletedByCap += info.changes;
    }
  }

  // Reclaim SD-card space when a big prune lands. Cheap when nothing changed.
  if (deletedByAge + deletedByCap > 0) {
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); }
    catch (err) { logger.warn(`[MessageArchive] wal_checkpoint failed: ${err.message}`); }
  }

  return { deletedByAge, deletedByCap };
}

module.exports = {
  insertChunk,
  searchFTS,
  searchSemantic,
  searchSemanticFull,
  getUnembeddedForChannel,
  setEmbedding,
  getMaxMessageIdForChannel,
  countForChannel,
  prune,
  close,
};
