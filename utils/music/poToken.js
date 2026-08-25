// YouTube gates every player client behind a Proof-of-Origin token. Without one the format list comes
// back storyboard-only ("Requested format is not available") or the media URLs answer 403, which is
// every failure mode the cookie jar was papering over. A token needs no account and costs about half
// a second to mint, so it replaces the jar rather than supplementing it.

const logger = require("../logger");

// YouTube's own lifetime may be as short as 12 hours, so refresh well inside it: a stale token fails closed and costs a track.
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

let cached = null;
let inFlight = null;
let nextAttemptAt = 0;

// Required lazily: the extractor's dependency tree is ESM, and pulling it in at load time drags it into every consumer of this module.
async function generate() {
  const { YoutubeiExtractor, generateToken } = require("discord-player-youtubei");
  const tube = YoutubeiExtractor.getInstance()?.innerTube;
  if (!tube) throw new Error("the YouTube extractor is not registered yet");

  const { poToken, visitorData } = await generateToken(tube);
  if (!poToken || !visitorData) throw new Error("the generator returned an empty token");

  return { poToken, visitorData, expiresAt: Date.now() + TOKEN_TTL_MS };
}

// Resolves null rather than throwing: no token degrades yt-dlp to its cookie and JS-free attempts, which is worse than a token but better than refusing the track.
async function getPoToken() {
  if (cached && cached.expiresAt > Date.now()) return cached;
  if (inFlight) return inFlight;
  if (Date.now() < nextAttemptAt) return null;

  // Shared so a queue starting several tracks at once mints one token rather than one each.
  inFlight = generate()
    .then(token => {
      cached = token;
      logger.info("[PoToken] Minted a YouTube proof-of-origin token.");
      return token;
    })
    .catch(err => {
      nextAttemptAt = Date.now() + RETRY_AFTER_FAILURE_MS;
      logger.warn(`[PoToken] Could not mint a token, falling back to the other yt-dlp strategies: ${err.message}`);
      return null;
    })
    .finally(() => { inFlight = null; });

  return inFlight;
}

function clearPoToken() {
  cached = null;
  inFlight = null;
  nextAttemptAt = 0;
}

module.exports = { getPoToken, clearPoToken, TOKEN_TTL_MS, RETRY_AFTER_FAILURE_MS };
