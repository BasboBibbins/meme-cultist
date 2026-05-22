// Shared embedding cache backed by better-sqlite3. Transparent to all callers
// of router.embed() — hits skip the Cloudflare round-trip entirely.
//
// Key: sha256(text + ":" + EMBED_MODEL) so a model change invalidates naturally.
// LRU prune fires every PRUNE_CHECK_INTERVAL inserts to keep the table under
// CACHE_MAX_ROWS without a COUNT(*) on every write.

const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const logger = require("../logger");

const EMBED_MODEL = "baai/bge-base-en-v1.5";
const CACHE_MAX_ROWS = 10_000;
const PRUNE_TO = 9_000;
const PRUNE_CHECK_INTERVAL = 100;

let _db = null;
let _insertCount = 0;

function openDb() {
  if (_db) return _db;
  const dbPath = process.env.EMBED_CACHE_TEST_DB || path.resolve(process.cwd(), "db/embeddings_cache.sqlite");
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("busy_timeout = 5000");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS embedding_cache (
      key TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_embed_lru ON embedding_cache(last_used_at);
  `);
  logger.log(`[EmbedCache] Opened ${dbPath} (WAL)`);
  return _db;
}

function cacheKey(text) {
  return crypto.createHash("sha256").update(`${text}:${EMBED_MODEL}`).digest("hex");
}

function get(text) {
  try {
    const db = openDb();
    const key = cacheKey(text);
    const row = db.prepare("SELECT embedding FROM embedding_cache WHERE key = ?").get(key);
    if (!row) return null;
    db.prepare("UPDATE embedding_cache SET last_used_at = ? WHERE key = ?").run(Date.now(), key);
    logger.debug(`[EmbedCache] hit key=${key.slice(0, 12)}…`);
    return new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
  } catch (err) {
    logger.warn(`[EmbedCache] get failed: ${err.message}`);
    return null;
  }
}

function set(text, embedding) {
  try {
    const db = openDb();
    const key = cacheKey(text);
    const buf = embedding instanceof Float32Array
      ? Buffer.from(embedding.buffer)
      : Buffer.from(new Float32Array(embedding).buffer);
    const now = Date.now();
    db.prepare(`
      INSERT INTO embedding_cache (key, embedding, created_at, last_used_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET last_used_at = excluded.last_used_at
    `).run(key, buf, now, now);

    _insertCount++;
    if (_insertCount % PRUNE_CHECK_INTERVAL === 0) {
      const count = db.prepare("SELECT COUNT(*) AS c FROM embedding_cache").get().c;
      if (count > CACHE_MAX_ROWS) {
        const toPrune = count - PRUNE_TO;
        db.prepare(`
          DELETE FROM embedding_cache WHERE key IN (
            SELECT key FROM embedding_cache ORDER BY last_used_at ASC LIMIT ?
          )
        `).run(toPrune);
        logger.debug(`[EmbedCache] pruned ${toPrune} LRU rows (was ${count})`);
      }
    }
  } catch (err) {
    logger.warn(`[EmbedCache] set failed: ${err.message}`);
  }
}

function close() {
  if (_db) {
    try { _db.close(); } catch (_) {}
    _db = null;
  }
}

module.exports = { get, set, close };
