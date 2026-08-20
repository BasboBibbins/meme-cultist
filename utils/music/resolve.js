// Turns a Track into something createAudioResource can take, and reports the StreamType
// so opus can be handed to Discord untouched.
//
// The whole point of the rewrite lives in the `opus` flag: a YouTube track that already has
// an opus rendition is 48kHz stereo in 20ms frames, which is exactly what Discord carries, so
// tagging it WebmOpus lets the voice layer skip both the decode and the re-encode. discord-player
// decoded it anyway unless all eight of its DSP stages were off, and doing that truncated playback.

const { StreamType } = require("discord-voip");
const { AudioFilters } = require("discord-player");
// AudioFilters is a class; the name-to-ffmpeg-expression map hangs off it as a static.
const FILTER_EXPRESSIONS = AudioFilters.filters ?? {};
const { spawn } = require("child_process");
const logger = require("../logger");
const {
  beforeCreateStream, afterStreamExtracted, remuxToOpus,
  isDrmProtected, bridgeToYoutube, createYtdlpStream, UnplayableTrackError, noteUnplayableReason,
} = require("./stream");

// Filters mean a real ffmpeg pass, so passthrough is off for as long as any are enabled.
function filterChain(names) {
  return names.map(name => FILTER_EXPRESSIONS[name]).filter(Boolean).join(",");
}

// Only reached when a filter is active. Everything else avoids ffmpeg entirely.
function applyFilters(source, chain) {
  const fromUrl = typeof source === "string";
  const input = fromUrl
    ? ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5", "-i", source]
    : ["-i", "pipe:0"];

  const child = spawn("ffmpeg", [
    "-nostdin", "-hide_banner",
    ...input,
    "-map", "0:a:0", "-vn",
    "-af", chain,
    "-c:a", "libopus", "-b:a", "192k",
    "-ar", "48000", "-ac", "2",
    "-frame_duration", "20",
    "-f", "webm",
    "-loglevel", "error",
    "pipe:1",
  ], { stdio: [fromUrl ? "ignore" : "pipe", "pipe", "pipe"] });

  if (!fromUrl) {
    source.pipe(child.stdin);
    source.on("error", () => child.kill("SIGKILL"));
    child.stdin.on("error", () => source.destroy?.());
  }

  let stderr = "";
  child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-2048); });
  child.on("close", code => {
    if (code !== 0 && stderr.trim()) logger.error(`[MusicResolve] filter chain exited ${code}: ${stderr.trim().slice(-300)}`);
  });
  child.stdout.on("close", () => {
    if (!child.killed) child.kill("SIGKILL");
    if (!fromUrl) source.destroy?.();
  });

  return child.stdout;
}

// discord-player is kept for search and metadata only; this is the one place its extractors
// are still asked for bytes, for the sources that are not YouTube.
async function extractorStream(track, player) {
  const extractor = track?.extractor ?? track?.__extractor ?? null;
  if (extractor && typeof extractor.stream === "function") {
    const result = await extractor.stream(track);
    if (result) return result;
  }
  if (player?.extractors?.requestBridge) {
    const bridged = await player.extractors.requestBridge(track);
    if (bridged?.result) return bridged.result;
  }
  return null;
}

// Returns { stream, type } for createAudioResource, or throws UnplayableTrackError.
async function resolvePlayable(track, { player, filters = [] } = {}) {
  const chain = filters.length ? filterChain(filters) : "";

  // YouTube goes through yt-dlp, which is the only thing that reliably tracks YouTube's changes.
  const direct = await beforeCreateStream(track);
  if (direct) {
    if (!chain) return { stream: direct.stream, type: direct.$fmt, passthrough: direct.$fmt === StreamType.WebmOpus };
    return { stream: applyFilters(direct.stream, chain), type: StreamType.WebmOpus, passthrough: false };
  }

  const raw = await extractorStream(track, player);
  if (!raw) {
    const reason = `**${track?.title || "That track"}** has no playable source.`;
    noteUnplayableReason(track, reason);
    throw new UnplayableTrackError(reason);
  }

  // SoundCloud serves major-label audio as FairPlay-encrypted HLS, which nothing here can decrypt.
  if (typeof raw === "string" && isDrmProtected(raw)) {
    const youtubeUrl = await bridgeToYoutube(track, { player });
    if (!youtubeUrl) {
      const reason = `**${track?.title || "That track"}** is DRM-protected at its source, and no playable alternative was found.`;
      noteUnplayableReason(track, reason);
      throw new UnplayableTrackError(reason);
    }
    logger.log(`[MusicResolve] "${track?.title}" is DRM-protected at source; playing the YouTube match instead.`);
    const { stream, opus } = await createYtdlpStream(youtubeUrl, track);
    if (!chain && opus) return { stream, type: StreamType.WebmOpus, passthrough: true };
    return { stream: chain ? applyFilters(stream, chain) : remuxToOpus(stream), type: StreamType.WebmOpus, passthrough: false };
  }

  const tagged = await afterStreamExtracted(raw, track, { player });
  const source = tagged?.stream ?? tagged ?? raw;
  if (chain) return { stream: applyFilters(source, chain), type: StreamType.WebmOpus, passthrough: false };
  return { stream: source, type: tagged?.$fmt ?? StreamType.WebmOpus, passthrough: false };
}

module.exports = { resolvePlayable, filterChain, applyFilters };
