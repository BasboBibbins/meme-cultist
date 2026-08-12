// YouTube audio is fetched with yt-dlp rather than the extractor's own format
// resolution, which fails against current YouTube ("Not matching URL for this
// format found"). yt-dlp is the only extractor that reliably tracks YouTube's
// changes, and it is already present via youtube-dl-exec.
//
// Format selection is deliberately plain `bestaudio`: constraining it to webm
// selects a format that returns HTTP 403 on download even though the URL
// resolves, which is a silent failure mode that costs hours to find.

const { spawn, spawnSync } = require("child_process");
const { constants } = require("youtube-dl-exec");
const { Track, StreamType, QueryType } = require("discord-player");
const axios = require("axios");
const logger = require("./logger");

const YTDLP = constants.YOUTUBE_DL_PATH;
const FORMAT = "bestaudio";
const PLAYLIST_LIMIT = 50;

// yt-dlp handles far more than YouTube, but every other provider in use streams
// correctly through its own extractor, so it is scoped to the one that does not.
function shouldUseYtdlp(url) {
  return typeof url === "string" && /(?:youtube\.com|youtu\.be)/i.test(url);
}

function createYtdlpStream(url) {
  const child = spawn(YTDLP, [
    "--format", FORMAT,
    "--output", "-",
    "--quiet",
    "--no-warnings",
    "--no-playlist",
    url,
  ], { stdio: ["ignore", "pipe", "pipe"] });

  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });

  child.on("error", err => {
    logger.error(`[MusicStream] yt-dlp failed to spawn: ${err.message}`);
    child.stdout.destroy(err);
  });

  // Teardown kills yt-dlp mid-write, so its "unable to write data" complaint is our own doing and must not read as a playback failure.
  let tornDown = false;
  child.on("close", code => {
    if (tornDown || code === 0 || !stderr.trim()) return;
    logger.error(`[MusicStream] yt-dlp exited ${code} for ${url}: ${stderr.trim().slice(0, 300)}`);
  });

  // Killing the child on stream teardown stops a skipped track leaking a process.
  child.stdout.on("close", () => {
    tornDown = true;
    if (!child.killed) child.kill("SIGKILL");
  });

  return child.stdout;
}

// discord-player's onBeforeCreateStream hook: returning null hands the track
// back to the extractor's own streaming path.
async function beforeCreateStream(track) {
  if (!shouldUseYtdlp(track?.url)) return null;
  logger.debug(`[MusicStream] Streaming via yt-dlp: ${track.title}`);
  return createYtdlpStream(track.url);
}

// discord-player unshifts "-ss" ahead of "-i" for URL-string sources, which corrupts AAC/HLS decoding — and SoundCloud and Spotify both return HLS. Remuxing to a Node stream avoids that path entirely.
//
// Raw PCM rather than Opus: re-encoding already-lossy AAC adds a generation of loss before Discord's own encoder runs, whereas decoding once to PCM leaves exactly one lossy step.
function remuxUrlToStream(url, { pcm = true } = {}) {
  const encode = pcm
    ? ["-ar", "48000", "-ac", "2", "-f", "s16le"]
    : ["-c:a", "libopus", "-b:a", "192k", "-f", "webm"];

  const child = spawn("ffmpeg", [
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
    "-i", url,
    "-vn",
    ...encode,
    "-loglevel", "error",
    "pipe:1",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  child.on("error", err => {
    logger.error(`[MusicStream] ffmpeg remux failed to spawn: ${err.message}`);
    child.stdout.destroy(err);
  });
  // As with yt-dlp, teardown makes ffmpeg complain about a failed write — our own kill, not a playback failure.
  let tornDown = false;
  child.on("close", code => {
    if (tornDown || code === 0 || !stderr.trim()) return;
    logger.error(`[MusicStream] ffmpeg remux exited ${code}: ${stderr.trim().slice(0, 300)}`);
  });
  child.stdout.on("close", () => {
    tornDown = true;
    if (!child.killed) child.kill("SIGKILL");
  });

  return child.stdout;
}

// Marks "this source can never play" as distinct from a transient stream error, so the caller can say why instead of retrying into the same wall.
class UnplayableTrackError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnplayableTrackError";
    this.unplayable = true;
  }
}

// discord-player rewraps a thrown stream error in its own NoResultError, so a custom property never reaches the handler; the reason is recorded here and claimed once.
const unplayableReasons = new Map();

function noteUnplayable(track, reason) {
  if (!track?.id) return;
  if (unplayableReasons.size > 50) unplayableReasons.clear();
  unplayableReasons.set(track.id, reason);
}

function takeUnplayableReason(track) {
  const reason = track?.id ? unplayableReasons.get(track.id) : null;
  if (reason) unplayableReasons.delete(track.id);
  return reason || null;
}

// SoundCloud serves major-label audio as FairPlay-encrypted HLS (/cbcs/ path, skd:// key nobody can fetch); ffmpeg decodes noise and yt-dlp refuses it outright. Spotify and Apple inherit this by bridging through SoundCloud.
function isDrmProtected(url) {
  return /\/cbcs\//i.test(url) || /skd:\/\//i.test(url);
}

// Nothing can decrypt that stream, so re-bridge to YouTube. No exact-match requirement: the first result for title+artist is the best available answer, and a near match beats refusing to play.
async function bridgeToYoutube(track, queue) {
  const player = queue?.player || queue;
  if (typeof player?.search !== "function" || !track?.title) return null;

  const withArtist = [track.title, track.author].filter(Boolean).join(" ");
  const attempts = [
    [withArtist, QueryType.YOUTUBE_SEARCH],
    [withArtist, QueryType.AUTO],
    [track.title, QueryType.YOUTUBE_SEARCH],
  ];

  for (const [query, searchEngine] of attempts) {
    try {
      const found = await player.search(query, { searchEngine });
      const url = found?.tracks?.[0]?.url;
      if (url) return url;
    } catch (err) {
      logger.warn(`[MusicStream] YouTube bridge attempt failed for "${query}": ${err.message}`);
    }
  }
  return null;
}

// Tagged {$fmt, stream}, not a bare Readable: with skipFFmpeg set, discord-player only takes its demuxable fast path for a tagged object and otherwise hands a bare Readable to a second ffmpeg that must guess the format.
async function afterStreamExtracted(stream, track, queue) {
  if (typeof stream !== "string" || !/^https?:\/\//.test(stream)) return stream;

  if (isDrmProtected(stream)) {
    const youtubeUrl = await bridgeToYoutube(track, queue);
    if (youtubeUrl) {
      logger.log(`[MusicStream] "${track?.title}" is DRM-protected at source; playing the YouTube match instead.`);
      return createYtdlpStream(youtubeUrl);
    }
    // Returning the URL anyway means ffmpeg decodes noise and the track "plays" for a fraction of a second; failing loudly lets the caller say why.
    const reason = `**${track?.title || "That track"}** is DRM-protected at its source, and no playable alternative was found.`;
    noteUnplayable(track, reason);
    throw new UnplayableTrackError(reason);
  }

  // Raw PCM only survives the demuxable fast path: an active /filter routes the stream through a second ffmpeg with no input-format hint, which cannot identify headerless PCM.
  const ffmpegFilters = queue?.filters?.ffmpeg?.args?.length ?? 0;
  if (ffmpegFilters > 0) {
    logger.debug(`[MusicStream] Remuxing to opus for "${track?.title}" (ffmpeg filters active)`);
    return { $fmt: StreamType.WebmOpus, stream: remuxUrlToStream(stream, { pcm: false }) };
  }

  logger.debug(`[MusicStream] Remuxing to PCM for "${track?.title}"`);
  return { $fmt: StreamType.Raw, stream: remuxUrlToStream(stream, { pcm: true }) };
}

// The Apple Music extractor reads og: tags, where og:site_name is literally "Apple Music", so every author is that placeholder and the real artist is absent from the payload. The ?i= parameter is the iTunes track id, which Apple's public lookup API resolves without a key.
const ITUNES_LOOKUP = "https://itunes.apple.com/lookup";
const APPLE_PLACEHOLDER_AUTHOR = "apple music";
const APPLE_ENRICH_LIMIT = 50;
const APPLE_ENRICH_CONCURRENCY = 5;

function isAppleMusicTrack(track) {
  const source = track?.raw?.source || track?.source;
  return source === "apple_music" || /music\.apple\.com/i.test(track?.url || "");
}

function appleTrackId(url) {
  if (typeof url !== "string") return null;
  const fromQuery = /[?&]i=(\d+)/.exec(url);
  if (fromQuery) return fromQuery[1];
  // Standalone song URLs carry the id as the last path segment instead.
  const fromPath = /music\.apple\.com\/[^?#]*?\/(\d+)(?:[?#]|$)/.exec(url);
  return fromPath ? fromPath[1] : null;
}

async function fetchItunesTrack(id) {
  try {
    const { data } = await axios.get(ITUNES_LOOKUP, { params: { id }, timeout: 8000 });
    const result = data?.results?.find(r => r?.wrapperType === "track") || data?.results?.[0];
    return result || null;
  } catch (err) {
    logger.warn(`[MusicStream] iTunes lookup failed for ${id}: ${err.message}`);
    return null;
  }
}

// Patched in place so the corrected author also reaches bridgeToYoutube, which searches "title author" — otherwise it looks up "<title> Apple Music".
async function enrichAppleMusicTrack(track) {
  if (!isAppleMusicTrack(track)) return false;
  if (String(track.author || "").trim().toLowerCase() !== APPLE_PLACEHOLDER_AUTHOR) return false;

  const id = appleTrackId(track.url);
  if (!id) return false;

  const info = await fetchItunesTrack(id);
  if (!info?.artistName) return false;

  track.author = info.artistName;
  if (info.trackName) track.title = info.trackName;
  if (info.artworkUrl100) track.thumbnail = info.artworkUrl100.replace(/\/\d+x\d+bb\./, "/512x512bb.");
  logger.debug(`[MusicStream] Apple Music author resolved: "${track.title}" -> ${info.artistName}`);
  return true;
}

async function enrichAppleMusicTracks(tracks, limit = APPLE_ENRICH_LIMIT) {
  if (!Array.isArray(tracks) || tracks.length === 0) return 0;
  const pending = tracks.filter(isAppleMusicTrack).slice(0, limit);
  if (pending.length === 0) return 0;

  let enriched = 0;
  for (let i = 0; i < pending.length; i += APPLE_ENRICH_CONCURRENCY) {
    const batch = pending.slice(i, i + APPLE_ENRICH_CONCURRENCY);
    const done = await Promise.all(batch.map(t => enrichAppleMusicTrack(t).catch(() => false)));
    enriched += done.filter(Boolean).length;
  }
  if (enriched > 0) logger.log(`[MusicStream] Resolved real artist for ${enriched} Apple Music track(s)`);
  return enriched;
}

function isYoutubePlaylist(query) {
  return typeof query === "string" && /(?:youtube\.com|youtu\.be)/i.test(query) && /[?&]list=/i.test(query);
}

function formatDuration(seconds) {
  if (!seconds || seconds < 0) return "0:00";
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

// The extractor resolves a playlist's title but returns zero tracks, so the
// entries are read from yt-dlp instead. One call yields every entry's metadata,
// which is far cheaper than searching each video individually.
function expandYoutubePlaylist(url, player, requestedBy, limit = PLAYLIST_LIMIT) {
  const result = spawnSync(YTDLP, [
    "--flat-playlist", "--dump-single-json",
    "--playlist-end", String(limit),
    "--no-warnings",
    url,
  ], { encoding: "utf8", timeout: 120000, maxBuffer: 1e8 });

  if (result.status !== 0) {
    logger.warn(`[MusicStream] yt-dlp could not read playlist ${url}: ${(result.stderr || "").trim().slice(0, 200)}`);
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (err) {
    logger.warn(`[MusicStream] Unparseable playlist JSON for ${url}: ${err.message}`);
    return [];
  }

  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  const tracks = entries.filter(e => e?.id).map(entry => new Track(player, {
    title: entry.title || "Unknown title",
    author: entry.channel || entry.uploader || "Unknown",
    url: `https://www.youtube.com/watch?v=${entry.id}`,
    thumbnail: entry.thumbnails?.[entry.thumbnails.length - 1]?.url || "",
    duration: formatDuration(entry.duration),
    views: 0,
    requestedBy,
    source: "youtube",
  }));

  logger.debug(`[MusicStream] Expanded playlist "${parsed.title || url}" to ${tracks.length} track(s)`);
  return tracks;
}

module.exports = { enrichAppleMusicTracks, enrichAppleMusicTrack, appleTrackId, isAppleMusicTrack, beforeCreateStream, afterStreamExtracted, UnplayableTrackError, takeUnplayableReason, isDrmProtected, bridgeToYoutube, remuxUrlToStream, createYtdlpStream, shouldUseYtdlp, isYoutubePlaylist, expandYoutubePlaylist, formatDuration, YTDLP, FORMAT, PLAYLIST_LIMIT };
