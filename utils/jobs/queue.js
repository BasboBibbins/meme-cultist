// Durable job queue backed by SQLite (better-sqlite3, WAL mode). The bot's
// background work — reminders, async embeddings, proactive triggers, retried
// failed LLM calls — will eventually all enqueue here. This PR ships the
// infrastructure dormant: no handlers are registered yet.
//
// Single-tenant assumptions:
//   - One bot process. The startup reaper rescues any job stuck in 'running'.
//   - SD-card friendly: WAL + synchronous=NORMAL, no per-event flush.

const path = require("path");
const Database = require("better-sqlite3");
const config = require("../../config.js");
const logger = require("../logger");
const { withLock } = require("../lock");

let _db = null;
let _ticking = false;
let _timer = null;
const _handlers = new Map();

function openDb() {
  if (_db) return _db;
  const dbPath = path.resolve(process.cwd(), config.JOB_DB_PATH || "db/jobs.sqlite");
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("busy_timeout = 5000");
  _db.exec(`
        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            payload TEXT NOT NULL,
            run_at INTEGER NOT NULL,
            priority INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 3,
            last_error TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(status, run_at, priority DESC);
    `);
  logger.log(`[Jobs] Opened ${dbPath} (WAL)`);
  return _db;
}

function enqueue({ kind, payload = {}, run_at = Date.now(), priority = 0, max_attempts = 3 } = {}) {
  if (!kind || typeof kind !== "string") throw new Error("Job kind is required.");
  const db = openDb();
  const now = Date.now();
  const stmt = db.prepare(`
        INSERT INTO jobs (kind, payload, run_at, priority, status, attempts, max_attempts, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)
    `);
  const info = stmt.run(kind, JSON.stringify(payload), run_at, priority, max_attempts, now, now);
  return info.lastInsertRowid;
}

function register(kind, handler) {
  if (typeof handler !== "function") throw new Error(`Job handler for "${kind}" must be a function.`);
  _handlers.set(kind, handler);
}

function stats() {
  const db = openDb();
  const rows = db.prepare("SELECT status, COUNT(*) AS c FROM jobs GROUP BY status").all();
  const out = { pending: 0, running: 0, done: 0, failed: 0, deferred: 0 };
  for (const r of rows) out[r.status] = r.c;
  return out;
}

function reapStaleRunning() {
  const db = openDb();
  const info = db.prepare("UPDATE jobs SET status='pending', updated_at=? WHERE status='running'").run(Date.now());
  if (info.changes > 0) logger.warn(`[Jobs] Startup reaper requeued ${info.changes} job(s) stuck in 'running'.`);
  // Deferred jobs are waiting on a provider, not on time. A restart re-tests that
  // assumption anyway (breakers start CLOSED), so nothing should stay deferred
  // across one.
  const revived = db.prepare("UPDATE jobs SET status='pending', run_at=?, updated_at=? WHERE status='deferred'").run(Date.now(), Date.now());
  if (revived.changes > 0) logger.log(`[Jobs] Startup reaper requeued ${revived.changes} deferred job(s).`);
}

// A deferred job is postponed, not attempted: `attempts` is deliberately rolled
// back so waiting out an outage cannot consume the retry budget that exists for
// genuine failures.
function defer(id, reason) {
  const db = openDb();
  db.prepare("UPDATE jobs SET status='deferred', attempts=MAX(attempts-1, 0), last_error=?, updated_at=? WHERE id=?")
    .run(String(reason).slice(0, 1000), Date.now(), id);
}

// Called when a breaker closes. Staggered rather than released at once: the
// embedding lane is capped at roughly one request per second, and a backlog
// arriving as a single burst would re-trip the breaker it was waiting on.
function releaseDeferred(kinds = []) {
  const db = openDb();
  const perSec = config.EMBED_BREAKER_DRAIN_RATE_PER_SEC || 1;
  const filter = kinds.length > 0 ? `AND kind IN (${kinds.map(() => "?").join(",")})` : "";
  const rows = db.prepare(`SELECT id FROM jobs WHERE status='deferred' ${filter} ORDER BY id ASC`).all(...kinds);
  if (rows.length === 0) return 0;
  const stmt = db.prepare("UPDATE jobs SET status='pending', run_at=?, updated_at=? WHERE id=?");
  const now = Date.now();
  rows.forEach((row, i) => stmt.run(now + Math.floor(i / perSec) * 1000, now, row.id));
  logger.log(`[Jobs] Released ${rows.length} deferred job(s) over ~${Math.ceil(rows.length / perSec)}s.`);
  return rows.length;
}

function countDeferred() {
  const db = openDb();
  return db.prepare("SELECT COUNT(*) AS c FROM jobs WHERE status='deferred'").get().c;
}

async function runJob(row) {
  const handler = _handlers.get(row.kind);
  if (!handler) {
    logger.warn(`[Jobs] No handler registered for kind="${row.kind}" (id=${row.id}). Marking failed.`);
    const db = openDb();
    db.prepare("UPDATE jobs SET status='failed', last_error=?, updated_at=? WHERE id=?")
      .run(`No handler for kind=${row.kind}`, Date.now(), row.id);
    return;
  }
  const payload = JSON.parse(row.payload || "{}");
  try {
    await withLock(`job:${row.id}`, () => handler(payload, { jobId: row.id, attempts: row.attempts }));
    const db = openDb();
    db.prepare("UPDATE jobs SET status='done', updated_at=?, last_error=NULL WHERE id=?").run(Date.now(), row.id);
  } catch (err) {
    const db = openDb();
    const msg = err?.message?.slice(0, 1000) || String(err).slice(0, 1000);
    // An open breaker means the call was never made. Treating that as a failure
    // would spend the retry budget waiting out an outage and then mark the job
    // permanently failed for a reason unrelated to the job itself.
    if (err?.breakerOpen) {
      defer(row.id, msg);
      logger.debug(`[Jobs] Job ${row.id} (${row.kind}) deferred — breaker open.`);
      return;
    }
    if (row.attempts >= row.max_attempts) {
      db.prepare("UPDATE jobs SET status='failed', last_error=?, updated_at=? WHERE id=?").run(msg, Date.now(), row.id);
      logger.error(`[Jobs] Job ${row.id} (${row.kind}) permanently failed after ${row.attempts} attempts: ${msg}`);
    } else {
      const backoffMs = Math.pow(2, row.attempts) * 1000;
      const nextRun = Date.now() + backoffMs;
      db.prepare("UPDATE jobs SET status='pending', run_at=?, last_error=?, updated_at=? WHERE id=?")
        .run(nextRun, msg, Date.now(), row.id);
      logger.warn(`[Jobs] Job ${row.id} (${row.kind}) failed (attempt ${row.attempts}/${row.max_attempts}); retrying in ${backoffMs}ms: ${msg}`);
    }
  }
}

async function tickOnce() {
  if (_ticking) return;
  _ticking = true;
  try {
    const db = openDb();
    const batchSize = config.JOB_BATCH_SIZE || 5;
    const due = db.prepare(`
            SELECT id, kind, payload, run_at, priority, status, attempts, max_attempts
            FROM jobs
            WHERE status='pending' AND run_at <= ?
            ORDER BY priority DESC, run_at ASC
            LIMIT ?
        `).all(Date.now(), batchSize);

    for (const row of due) {
      const claim = db.prepare(`
                UPDATE jobs SET status='running', attempts=attempts+1, updated_at=?
                WHERE id=? AND status='pending'
            `).run(Date.now(), row.id);
      if (claim.changes === 0) continue;
      // Refetch with new attempt count for backoff math.
      const claimed = db.prepare("SELECT * FROM jobs WHERE id=?").get(row.id);
      await runJob(claimed);
    }
  } catch (err) {
    logger.error(`[Jobs] Tick loop error: ${err.message}`);
  } finally {
    _ticking = false;
  }
}

function start({ tickIntervalMs } = {}) {
  const interval = tickIntervalMs || config.JOB_TICK_MS || 2000;
  openDb();
  reapStaleRunning();
  if (_timer) return;
  _timer = setInterval(() => { tickOnce(); }, interval);
  if (_timer.unref) _timer.unref();
  logger.log(`[Jobs] Tick loop started (every ${interval}ms, batch=${config.JOB_BATCH_SIZE || 5})`);
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  if (_db) {
    try { _db.close(); } catch (_) {}
    _db = null;
  }
  logger.log("[Jobs] Tick loop stopped");
}

function list(kind, filterFn = null) {
  const db = openDb();
  const rows = db.prepare("SELECT id, payload, run_at, priority, status, created_at FROM jobs WHERE kind = ? AND status IN ('pending','running') ORDER BY run_at ASC").all(kind);
  return filterFn ? rows.filter(filterFn) : rows;
}

// Callers that accept a user-supplied job id (e.g. `/remind cancel`) MUST pass
// `ownerPredicate` so a user cannot cancel another user's job by guessing ids.
// The predicate runs against the row's parsed payload; returning false leaves
// the row untouched and `cancel` reports `false`. When the id is internal
// (e.g. job handler self-cancellation), omit the predicate.
function cancel(id, ownerPredicate = null) {
  const db = openDb();
  if (ownerPredicate) {
    const row = db.prepare("SELECT id, kind, payload, status FROM jobs WHERE id = ?").get(id);
    if (!row || (row.status !== "pending" && row.status !== "running")) return false;
    let payload;
    try { payload = JSON.parse(row.payload); }
    catch (_) { return false; }
    if (!ownerPredicate(payload, row)) return false;
  }
  const info = db.prepare("UPDATE jobs SET status='cancelled', updated_at=? WHERE id=? AND status IN ('pending','running')").run(Date.now(), id);
  return info.changes > 0;
}

module.exports = { enqueue, register, start, stop, stats, tickOnce, list, cancel, defer, releaseDeferred, countDeferred };
