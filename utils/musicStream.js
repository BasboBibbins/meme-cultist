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
const { Track } = require("discord-player");
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

  child.on("close", code => {
    if (code !== 0 && stderr.trim()) {
      logger.error(`[MusicStream] yt-dlp exited ${code} for ${url}: ${stderr.trim().slice(0, 300)}`);
    }
  });

  // Killing the child on stream teardown stops a skipped track leaking a process.
  child.stdout.on("close", () => {
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

module.exports = { beforeCreateStream, createYtdlpStream, shouldUseYtdlp, isYoutubePlaylist, expandYoutubePlaylist, formatDuration, YTDLP, FORMAT, PLAYLIST_LIMIT };
