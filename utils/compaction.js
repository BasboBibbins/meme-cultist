// Archive → episode compaction.
//
// Every 6 h (scheduled in bot.js via node-schedule) this module runs one
// compaction window per chatbot channel: if a channel's message_chunks row
// count exceeds ARCHIVE_COMPACTION_THRESHOLD, the oldest SUMMARY_INTERVAL
// chunks are summarised by DeepSeek into a single episode entry, those chunks
// are deleted from the archive, and the oldest channel summary is pruned from
// the thread context so the two tiers stay in sync.
//
// Incognito safety: the archive never indexed incognito users' messages (guard
// lives in the archive write path), so compacted episodes are already clean.

const { CONVO_MODEL, SUMMARY_INTERVAL, ARCHIVE_COMPACTION_THRESHOLD, CHATBOT_CHANNELS } = require("../config.js");
const logger = require("./logger");
const llm = require("./llm");
const messageArchive = require("./messageArchive");
const episodes = require("./episodes");
const jobs = require("./jobs");
const { getThreadContext, updateThreadContext } = require("./openai");

// Maximum character length of a single chunk included in the compaction prompt.
// Long messages are truncated to keep the prompt bounded.
const CHUNK_MAX_CHARS = 300;

function formatChunksForPrompt(chunks) {
  return chunks.map(c => {
    const ts = new Date(c.created_at).toISOString().slice(0, 16).replace("T", " ");
    const text = c.content.length > CHUNK_MAX_CHARS
      ? c.content.slice(0, CHUNK_MAX_CHARS) + "…"
      : c.content;
    return `[${ts}] user_${c.author_id}: ${text}`;
  }).join("\n");
}

// Compact one SUMMARY_INTERVAL window for a single channel.
// Returns a result object on success, null if the channel is below threshold or
// has no chunks to compact. Throws on unrecoverable LLM failure.
async function compactChannel(channelId) {
  const count = messageArchive.countForChannel(channelId);
  if (count <= ARCHIVE_COMPACTION_THRESHOLD) {
    logger.debug(`[Compaction] ${channelId}: ${count} chunks <= threshold ${ARCHIVE_COMPACTION_THRESHOLD}, skipping`);
    return null;
  }

  const chunks = messageArchive.getOldestChunks(channelId, SUMMARY_INTERVAL);
  if (chunks.length === 0) return null;

  logger.log(`[Compaction] ${channelId}: compacting ${chunks.length} chunks (archive has ${count})`);

  const excerpt = formatChunksForPrompt(chunks);
  const prompt = [
    "You are a long-term memory assistant. Compress the following Discord chat excerpt into ONE episode entry.",
    "An episode records a specific event or milestone that occurred, not general facts.",
    "Rules:",
    "- summary: 1-2 sentences, past tense, concrete (who, what happened, outcome). Max 250 characters.",
    "- tags: 2-5 short lowercase keywords that help retrieve this episode later (e.g. [\"jackpot\", \"slots\", \"basbo\"]).",
    "Respond with ONLY valid JSON: {\"summary\": \"...\", \"tags\": [\"...\"]}",
    "",
    "[Chat excerpt]",
    excerpt,
  ].join("\n");

  const res = await llm.chat({
    model: CONVO_MODEL,
    messages: [
      { role: "system", content: "You compress Discord chat into structured episode memory. Output only JSON." },
      { role: "user", content: prompt },
    ],
    max_tokens: 256,
    temperature: 0.2,
    response_format: { type: "json_object" },
    timeoutMs: 30_000,
    label: "compactEpisode",
    variant: "compaction",
  });

  let parsed;
  try {
    parsed = JSON.parse(res.result.content);
  } catch (err) {
    throw new Error(`Compaction LLM returned non-JSON: ${res.result.content?.slice(0, 100)}`);
  }

  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  const tags = Array.isArray(parsed.tags) ? parsed.tags.filter(t => typeof t === "string") : [];

  if (!summary) throw new Error("Compaction LLM returned empty summary");

  // Write episode
  const episodeId = episodes.addEpisode({
    scopeType: "channel",
    scopeId: channelId,
    summary,
    tags,
    source: "compaction",
  });

  // Async embed via job queue
  jobs.enqueue({
    kind: "episode_embed",
    payload: { episodeIds: [episodeId] },
    run_at: Date.now(),
    priority: -1,
  });

  // Delete compacted chunks
  const chunkIds = chunks.map(c => c.id);
  const deleted = messageArchive.deleteChunks(chunkIds);
  logger.log(`[Compaction] ${channelId}: episode ${episodeId} created, ${deleted} chunks removed`);

  // Prune oldest channel summary from thread context so the two tiers stay
  // aligned — the episode now covers what that summary described.
  try {
    const ctx = await getThreadContext({ id: channelId });
    if (ctx && Array.isArray(ctx.summaries) && ctx.summaries.length > 0) {
      await updateThreadContext({ id: channelId }, { summaries: ctx.summaries.slice(1) });
      logger.debug(`[Compaction] ${channelId}: pruned oldest channel summary`);
    }
  } catch (err) {
    // Non-fatal: the episode was already written. Log and continue.
    logger.warn(`[Compaction] ${channelId}: summary prune failed: ${err.message}`);
  }

  return { episodeId, summary, chunksCompacted: chunks.length };
}

// Run one compaction window across all configured chatbot channels.
// Errors in individual channels are caught so one bad channel can't stall the rest.
async function runCompactionJob() {
  logger.log("[Compaction] Starting compaction pass");
  let compacted = 0;
  let skipped = 0;
  let errors = 0;

  for (const channelId of CHATBOT_CHANNELS) {
    try {
      const result = await compactChannel(channelId);
      if (result) {
        compacted++;
        logger.log(`[Compaction] ${channelId}: "${result.summary.slice(0, 80)}…"`);
      } else {
        skipped++;
      }
    } catch (err) {
      errors++;
      logger.error(`[Compaction] ${channelId} failed: ${err.message}`);
    }
  }

  logger.log(`[Compaction] Pass complete: ${compacted} compacted, ${skipped} skipped, ${errors} errors`);
}

module.exports = { runCompactionJob, compactChannel };
