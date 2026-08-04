// Embedding job handlers, extracted from bot.js so their failure behaviour can
// be tested.
//
// The contract every handler here obeys: **let failures reach the queue.** These
// handlers used to catch their own errors and return normally, which marks the
// job 'done' even though nothing was embedded — the entry stays permanently
// unembedded and no queue row survives to show it. That is silent data loss, and
// it is invisible precisely because embedding is a background enhancement (FTS
// keeps serving retrieval, so nothing looks broken).
//
// Throwing hands control to runJob, which backs off exponentially, retries up to
// max_attempts, and only then marks 'failed' — a state that is at least visible
// in `jobs.stats()`.
//
// Retries are safe to repeat: every batch fetch below filters on
// `embedding IS NULL`, so a retry re-processes only what is still outstanding
// and never re-embeds work that already succeeded.

const logger = require("../logger");

// Batch handlers collect per-item errors instead of throwing on the first one,
// so a single bad item cannot abandon the rest of the batch — then fail the job
// at the end if anything is still outstanding, so the remainder gets retried.
function summarizeBatchFailure(kind, failed, total, lastError) {
  return new Error(`${failed}/${total} ${kind} failed; last error: ${lastError.message}`);
}

function makeKbEmbed({ kbStore, llm }) {
  return async function kbEmbed(payload) {
    const { guildId, slug } = payload;
    const entry = kbStore.getBySlug(guildId, slug);
    // A deleted entry is genuinely nothing to do. Retrying cannot conjure it
    // back, so this returns rather than throws.
    if (!entry) {
      logger.warn(`[KB Embed] Entry ${slug} not found in guild ${guildId}`);
      return;
    }
    const text = `${entry.title}\n${entry.content}`;
    const { embedding } = await llm.embed({ text });
    kbStore.setEmbedding(guildId, slug, embedding);
    logger.log(`[KB Embed] Embedded "${slug}" (${embedding.length} dims)`);
  };
}

function makeMessageEmbed({ messageArchive, llm }) {
  return async function messageEmbed(payload) {
    const { channelId, chunkIds } = payload;
    const all = messageArchive.getUnembeddedForChannel(channelId, 100);
    const unembedded = chunkIds && chunkIds.length > 0
      ? all.filter(r => chunkIds.includes(r.id))
      : all;
    if (unembedded.length === 0) return;

    let embedded = 0;
    let lastError = null;
    for (const chunk of unembedded) {
      try {
        const { embedding } = await llm.embed({ text: chunk.content });
        messageArchive.setEmbedding(chunk.id, embedding);
        embedded += 1;
      } catch (err) {
        lastError = err;
        logger.error(`[MessageEmbed] Failed for chunk ${chunk.id}: ${err.message}`);
      }
    }
    logger.log(`[MessageEmbed] Embedded ${embedded}/${unembedded.length} chunks for ${channelId}`);
    if (lastError) throw summarizeBatchFailure("chunks", unembedded.length - embedded, unembedded.length, lastError);
  };
}

function makeEpisodeEmbed({ episodeStore, llm }) {
  return async function episodeEmbed(payload) {
    const { episodeIds } = payload;
    if (!episodeIds || episodeIds.length === 0) return;
    const unembedded = episodeStore.getByIds(episodeIds);
    if (unembedded.length === 0) return;

    let embedded = 0;
    let lastError = null;
    for (const ep of unembedded) {
      try {
        const { embedding } = await llm.embed({ text: ep.summary });
        episodeStore.setEmbedding(ep.id, embedding);
        embedded += 1;
      } catch (err) {
        lastError = err;
        logger.error(`[EpisodeEmbed] Failed for episode ${ep.id}: ${err.message}`);
      }
    }
    if (embedded > 0) logger.log(`[EpisodeEmbed] Embedded ${embedded}/${unembedded.length} episodes`);
    if (lastError) throw summarizeBatchFailure("episodes", unembedded.length - embedded, unembedded.length, lastError);
  };
}

// Deps are injected rather than required here so the handlers stay testable
// without loading the SQLite stores.
function registerEmbedHandlers(jobs, deps) {
  jobs.register("kb_embed", makeKbEmbed(deps));
  jobs.register("message_embed", makeMessageEmbed(deps));
  jobs.register("episode_embed", makeEpisodeEmbed(deps));
}

module.exports = { registerEmbedHandlers, makeKbEmbed, makeMessageEmbed, makeEpisodeEmbed };
