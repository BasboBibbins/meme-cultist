const logger = require("../logger");

const PAGE_SIZE = 100;

// Mirrors the live archive filter so a backfilled row is one the live path would also have stored.
function isArchivable(msg, { oocPrefix, bannedRoleId }) {
  if (!msg?.id || !msg.author || !msg.content) return false;
  if (msg.webhookId || msg.system || msg.hasThread) return false;
  if (msg.content.startsWith(oocPrefix) || msg.content.startsWith("⏳")) return false;
  if (bannedRoleId && msg.member?.roles?.cache?.some(role => role.id === bannedRoleId)) return false;
  return true;
}

// Snowflakes sort by time, and comparing them avoids relying on the order a Collection was built in.
function oldestMessageId(ids) {
  let oldest = null;
  for (const id of ids) {
    if (oldest === null || BigInt(id) < BigInt(oldest)) oldest = id;
  }
  return oldest;
}

async function backfillPages(channel, { before = null, maxPages, archive }) {
  let cursor = before;
  let scanned = 0;
  let inserted = 0;
  let oldestAt = null;
  for (let page = 0; page < maxPages; page++) {
    const fetched = await channel.messages.fetch(cursor ? { limit: PAGE_SIZE, before: cursor } : { limit: PAGE_SIZE });
    if (fetched.size === 0) return { cursor, scanned, inserted, oldestAt, done: true };
    for (const msg of fetched.values()) {
      scanned++;
      if (await archive(msg)) inserted++;
    }
    cursor = oldestMessageId(fetched.keys());
    oldestAt = fetched.get(cursor)?.createdTimestamp ?? oldestAt;
    if (fetched.size < PAGE_SIZE) return { cursor, scanned, inserted, oldestAt, done: true };
  }
  return { cursor, scanned, inserted, oldestAt, done: false };
}

async function runFullBackfill(channel, { archive, pagesPerRun, onProgress = () => {} }) {
  let cursor = null;
  let scanned = 0;
  let inserted = 0;
  for (;;) {
    const result = await backfillPages(channel, { before: cursor, maxPages: pagesPerRun, archive });
    scanned += result.scanned;
    inserted += result.inserted;
    cursor = result.cursor;
    onProgress({ scanned, inserted, oldestAt: result.oldestAt, done: result.done });
    if (result.done) return { scanned, inserted, oldestAt: result.oldestAt };
  }
}

function isBackfillFor(channelId, excludeJobId) {
  return (row) => {
    if (row.id === excludeJobId) return false;
    try {
      return JSON.parse(row.payload).channelId === channelId;
    } catch (_) {
      return false;
    }
  };
}

// One chain per channel, so a second launch with `backfill` cannot fork a parallel scan.
function enqueueBackfill(jobs, channelId, { before = null, delayMs = 0, excludeJobId = null } = {}) {
  if (jobs.list("backfill_messages", isBackfillFor(channelId, excludeJobId)).length > 0) return false;
  jobs.enqueue({ kind: "backfill_messages", payload: { channelId, before }, run_at: Date.now() + delayMs, priority: -1 });
  return true;
}

function makeBackfill({ jobs, fetchChannel, archiveMessage, onInserted, pagesPerRun, delayMs }) {
  return async function backfill(payload, ctx = {}) {
    const channelIds = payload.channelId ? [payload.channelId] : (payload.channelIds || []);
    for (const channelId of channelIds) {
      const channel = await fetchChannel(channelId);
      if (!channel?.messages) continue;
      const seenAuthors = new Map();
      const result = await backfillPages(channel, {
        before: payload.channelId ? payload.before : null,
        maxPages: pagesPerRun,
        archive: (msg) => archiveMessage(channelId, msg, seenAuthors),
      });
      if (result.inserted > 0) onInserted(channelId);
      const reached = result.oldestAt ? new Date(result.oldestAt).toISOString().slice(0, 10) : "the start";
      if (result.done) {
        logger.log(`[Backfill] ${channelId}: complete, reached ${reached}. Last batch inserted ${result.inserted} of ${result.scanned}.`);
      } else {
        logger.log(`[Backfill] ${channelId}: inserted ${result.inserted} of ${result.scanned}, back to ${reached}. Continuing.`);
        enqueueBackfill(jobs, channelId, { before: result.cursor, delayMs, excludeJobId: ctx.jobId });
      }
    }
  };
}

function registerBackfillHandler(jobs, deps) {
  jobs.register("backfill_messages", makeBackfill({ jobs, ...deps }));
}

module.exports = { isArchivable, oldestMessageId, backfillPages, runFullBackfill, enqueueBackfill, makeBackfill, registerBackfillHandler, PAGE_SIZE };
