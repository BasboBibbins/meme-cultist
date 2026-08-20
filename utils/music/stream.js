// YouTube audio is fetched with yt-dlp rather than the extractor's own format
// resolution, which fails against current YouTube ("Not matching URL for this
// format found"). yt-dlp is the only extractor that reliably tracks YouTube's
// changes, and it is already present via youtube-dl-exec.
//
// Format selection stays codec-agnostic: constraining it to webm selects a format
// that returns HTTP 403 on download even though the URL resolves, which is a silent
// failure mode that costs hours to find. It is `bestaudio/best` rather than bare
// `bestaudio` because a strict selector aborts outright when YouTube answers with a
// storyboard-only format list, which is what ytdlpAttempts() below recovers from.

const fs = require("fs");
const { PassThrough } = require("stream");
const { spawn, spawnSync } = require("child_process");
const { constants } = require("youtube-dl-exec");
const { Track, StreamType, QueryType } = require("discord-player");
const axios = require("axios");
const { YTDLP_COOKIES } = require("../../config.js");
const logger = require("../logger");
const { getPoToken } = require("./poToken");

const YTDLP = constants.YOUTUBE_DL_PATH;
// `/best` matters: bare `bestaudio` is a strict selector that aborts the whole download when YouTube returns no audio-only format.
const FORMAT = "bestaudio/best";

// Format 251 is webm/opus, 48kHz stereo, 20ms frames, which is precisely what Discord carries, so landing on it means no transcode and no second lossy generation. This pins it and falls back only within opus.
const OPUS_FORMAT = "251/bestaudio[acodec=opus][asr=48000][abr>=96]/bestaudio[acodec=opus][asr=48000]/bestaudio[acodec=opus]";

// ios leads because it is the only one of these needing no JS challenge solved, worth several seconds per track, and it still lists the adaptive audio-only formats. The web clients are deliberately absent: they are offered nothing but muxed 360p video whose audio is 44.1kHz AAC.
const OPUS_CLIENTS = ["ios", "web_embedded", "mweb"];
const PLAYLIST_LIMIT = 50;

// A PassThrough defaults to 16KB, which makes yt-dlp deliver in lockstep with playback and turns any network or scheduler hiccup into an underrun.
const STREAM_BUFFER_BYTES = 4 * 1024 * 1024;

// yt-dlp caches player and nsig JS under ~/.cache/yt-dlp, which is a disk write per extraction. The host runs from an SD card, so nothing here may touch it.
const NO_DISK = ["--no-cache-dir", "--no-part", "--no-write-info-json", "--no-write-thumbnail"];

// A stalled TCP connect otherwise hangs the attempt until the process is killed, and the queue sits silent the whole time.
const NETWORK = ["--socket-timeout", "15", "--retries", "3"];

// An attempt that has produced nothing by now is wedged rather than slow, and the next strategy is worth more than waiting on it.
const FIRST_BYTE_TIMEOUT_MS = 20000;

// yt-dlp can narrate at length on failure, and only the tail is diagnostic. Bounding it keeps a broken extractor from growing a string per track.
const STDERR_CAP = 4096;

// 192k matches what the old filter-only encode path already used; libopus's own VBR then adapts the actual rate downward on quiet passages.
const OPUS_BITRATE = "192k";

// The clients that do not need a solved JS challenge. YouTube now answers the web clients with a storyboard-only format list, which is what "Requested format is not available" actually means.
const JS_FREE_CLIENTS = "youtube:player_client=android_vr,ios,tv";

// YouTube's `n` challenge has to be solved in JavaScript, and yt-dlp only enables deno
// by default. With no runtime it degrades to storyboard-only formats, and once a cookie
// jar makes requests authenticated that degradation hits EVERY video, not just the
// age-restricted ones cookies were added for. Pointed at this process's own binary
// rather than bare "node" so it resolves regardless of the spawned process's PATH.
const JS_RUNTIME = ["--js-runtimes", `node:${process.execPath}`];

// Two ways a cookie jar misfires, both resolved once here rather than per track.
// A path that does not exist is ignored silently by yt-dlp, which then reports the
// ordinary age-gate error, so a typo looks identical to having configured nothing.
// An empty jar is worse: YouTube answers 403 for every video and the error never
// mentions cookies, so passing no --cookies beats passing an empty one.
function resolveCookieArgs() {
  if (!YTDLP_COOKIES) return [];

  if (!fs.existsSync(YTDLP_COOKIES)) {
    logger.warn(`[MusicStream] YTDLP_COOKIES points at "${YTDLP_COOKIES}", which does not exist. Age-restricted videos will fail.`);
    return [];
  }

  const entries = fs.readFileSync(YTDLP_COOKIES, "utf8")
    .split("\n")
    .filter(line => line.trim() && !line.trim().startsWith("#"));

  if (!entries.length) {
    logger.warn(`[MusicStream] YTDLP_COOKIES at "${YTDLP_COOKIES}" contains no cookies, ignoring it, since an empty jar makes every download fail with a 403.`);
    return [];
  }

  logger.log(`[MusicStream] Using yt-dlp cookies from ${YTDLP_COOKIES} (${entries.length} entries)`);
  return ["--cookies", YTDLP_COOKIES];
}

const cookieArgs = resolveCookieArgs();

// Recorded once at startup: a format-resolution failure is undiagnosable without knowing which
// yt-dlp is on the box, and each host's binary is whatever its last install happened to fetch.
function logYtdlpDiagnostics() {
  const result = spawnSync(YTDLP, ["--version"], { encoding: "utf8", timeout: 15000 });
  const version = (result.stdout || "").trim();

  if (result.status !== 0 || !version) {
    logger.error(`[MusicStream] yt-dlp is not runnable at ${YTDLP}. YouTube playback will fail.`);
    return;
  }
  logger.info(`[MusicStream] yt-dlp ${version} at ${YTDLP}${cookieArgs.length ? ", cookies enabled" : ""}`);
}

// yt-dlp handles far more than YouTube, but every other provider in use streams
// correctly through its own extractor, so it is scoped to the one that does not.
function shouldUseYtdlp(url) {
  return typeof url === "string" && /(?:youtube\.com|youtu\.be)/i.test(url);
}

// Ordered recovery chain, each step tried only when the one before produced no audio at all.
// A cookie jar is the trigger rather than the format string: cookies bar the JS-free clients, so
// yt-dlp falls to the web clients that YouTube now answers with storyboards only.
//
// The token attempt leads because it is the only one that currently works unaided; everything below it
// is kept as a fallback for the window where minting fails, not because any of it is expected to.
function ytdlpAttempts(token = null) {
  const base = [
    "--output", "-",
    "--quiet",
    "--no-warnings",
    "--no-playlist",
    ...NO_DISK,
    ...NETWORK,
    ...JS_RUNTIME,
  ];

  // Bound to the visitor data it was minted with, so the two must travel together or YouTube rejects both.
  const withToken = (client) => ["--extractor-args",
    `youtube:player_client=${client};po_token=${client}.gvs+${token.poToken};visitor_data=${token.visitorData}`];

  const attempts = [];

  if (token) {
    for (const client of OPUS_CLIENTS) {
      attempts.push({ label: `${client} opus`, opus: true, args: [...base, "--format", OPUS_FORMAT, ...withToken(client)] });
    }
    // Reached only by a video with no opus rendition at all, which then has to be transcoded like any other source.
    attempts.push({ label: "ios any format", opus: false, args: [...base, "--format", FORMAT, ...withToken("ios")] });
  }

  if (cookieArgs.length) attempts.push({ label: "cookies", opus: false, args: [...base, "--format", FORMAT, ...cookieArgs] });
  attempts.push({ label: "no cookies", opus: false, args: [...base, "--format", FORMAT] });
  attempts.push({ label: "JS-free clients", opus: false, args: [...base, "--format", FORMAT, "--extractor-args", JS_FREE_CLIENTS] });
  return attempts;
}

// A PassThrough rather than the child's stdout directly, so a failed attempt can be replaced by the
// next one without the consumer ever seeing the swap. Retrying is only safe while nothing has been
// written, which is why a partial stream ends rather than restarting.
//
// Resolves { stream, opus } once audio is actually flowing and rejects when no attempt produced any, so
// a dead track fails while discord-player is still awaiting the hook. Destroying the returned stream
// instead would go unheard: the demuxable fast path only pipes, so nothing listens for its error.
//
// `opus` reports whether the attempt that won was pinned to an opus rendition, which is the caller's
// signal that it can hand the bytes straight to Discord rather than paying for a transcode.
async function createYtdlpStream(url, track = null) {
  const attempts = ytdlpAttempts(await getPoToken());

  return new Promise((resolve, reject) => {
    const out = new PassThrough({ highWaterMark: STREAM_BUFFER_BYTES });
    let child = null;
    let tornDown = false;
    let handedOver = false;

    // Killing the child on stream teardown stops a skipped track leaking a process.
    out.on("close", () => {
      tornDown = true;
      if (child && !child.killed) child.kill("SIGKILL");
    });

    const runAttempt = (index) => {
      if (tornDown) return;

      if (index >= attempts.length) {
        const reason = `**${track?.title || "That track"}** could not be streamed. YouTube returned no playable audio for it.`;
        noteUnplayable(track, reason);
        logger.error(`[MusicStream] every yt-dlp strategy failed for ${url}`);
        out.destroy();
        return reject(new UnplayableTrackError(reason));
      }

      const attempt = attempts[index];
      const active = child = spawn(YTDLP, [...attempt.args, url], { stdio: ["ignore", "pipe", "pipe"] });
      let bytes = 0;
      let stderr = "";
      let settled = false;

      // Only the tail is diagnostic, so the head is dropped rather than growing the string unboundedly.
      active.stderr.on("data", chunk => {
        stderr = (stderr + chunk.toString()).slice(-STDERR_CAP);
      });

      // A wedged attempt never exits and never writes, so `close` alone would leave the queue silent indefinitely. Killing it routes into the same close handler that advances the chain.
      const stallTimer = setTimeout(() => {
        if (settled || bytes > 0) return;
        logger.warn(`[MusicStream] yt-dlp (${attempt.label}) produced nothing in ${FIRST_BYTE_TIMEOUT_MS}ms for ${url}, moving on`);
        if (!active.killed) active.kill("SIGKILL");
      }, FIRST_BYTE_TIMEOUT_MS);
      // The bot outlives any one track, so a pending timer must never hold the process open.
      if (typeof stallTimer.unref === "function") stallTimer.unref();

      // Handing over on the first chunk rather than on exit: waiting for the process to finish would buffer the entire track before a note played.
      active.stdout.on("data", chunk => {
        bytes += chunk.length;
        if (handedOver) return;
        handedOver = true;
        clearTimeout(stallTimer);
        logger.debug(`[MusicStream] yt-dlp (${attempt.label}) is producing ${attempt.opus ? "native opus" : "transcodable"} audio for ${url}`);
        resolve({ stream: out, opus: !!attempt.opus });
      });
      active.stdout.pipe(out, { end: false });

      active.on("error", err => {
        if (settled) return;
        settled = true;
        clearTimeout(stallTimer);
        logger.error(`[MusicStream] yt-dlp failed to spawn: ${err.message}`);
        if (!tornDown) runAttempt(index + 1);
      });

      // Teardown kills yt-dlp mid-write, so its "unable to write data" complaint is our own doing and must not read as a playback failure.
      active.on("close", code => {
        if (settled) return;
        settled = true;
        clearTimeout(stallTimer);
        if (tornDown) return;
        if (bytes > 0) return out.end();
        logger.warn(`[MusicStream] yt-dlp (${attempt.label}) returned no audio for ${url}, exit ${code}: ${stderr.trim().slice(-200)}`);
        runAttempt(index + 1);
      });
    };

    runAttempt(0);
  });
}

// discord-player's onBeforeCreateStream hook: returning null hands the track
// back to the extractor's own streaming path.
//
// Tagged rather than the bare Readable yt-dlp produces: an untagged stream misses the demuxable fast path and is handed to a second ffmpeg that emits PCM, which then has to be opus-encoded on the event loop.
async function beforeCreateStream(track) {
  if (!shouldUseYtdlp(track?.url)) return null;
  logger.debug(`[MusicStream] Streaming via yt-dlp: ${track.title}`);
  return toWebmOpus(await createYtdlpStream(track.url, track));
}

// A native opus rendition is already 48kHz stereo in 20ms frames, so transcoding it would only add a
// second lossy generation and an encoder the Pi has to run. Anything else still has to go through one.
function toWebmOpus({ stream, opus }) {
  return { $fmt: StreamType.WebmOpus, stream: opus ? stream : remuxToOpus(stream) };
}

// discord-player unshifts "-ss" ahead of "-i" for URL-string sources, which corrupts AAC/HLS decoding, and SoundCloud and Spotify both return HLS. Remuxing to a Node stream avoids that path entirely.
//
// Opus rather than raw PCM: the JS DSP chain is disabled, so discord-player passes tagged opus straight to Discord and never decodes it. Encoding here keeps that work in ffmpeg's own process instead of on the event loop, which is what the Pi cannot afford.
function remuxToOpus(source) {
  const fromUrl = typeof source === "string";
  // Reconnect flags apply to a network input only, and ffmpeg rejects them ahead of a pipe.
  const input = fromUrl
    ? ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5", "-i", source]
    : ["-i", "pipe:0"];

  const child = spawn("ffmpeg", [
    // Without this ffmpeg grabs the parent's stdin on the URL path, where nothing is piped to it, and can swallow the terminal.
    "-nostdin",
    "-hide_banner",
    ...input,
    // A muxed source can carry several audio streams, and -vn alone leaves which one ambiguous.
    "-map", "0:a:0",
    "-vn",
    "-c:a", "libopus",
    "-b:a", OPUS_BITRATE,
    // Opus is 48kHz stereo by definition; pinning it means a 44.1kHz or mono source is resampled here rather than anywhere downstream.
    "-ar", "48000",
    "-ac", "2",
    // Discord's voice protocol carries 20ms frames, and the demuxer downstream assumes them.
    "-frame_duration", "20",
    // Complexity defaults to 10 (max) when left unset. This process is native C, not JS on the event loop, so there is no Pi-side reason to trade it away, and doing so audibly crushed bass-heavy tracks.
    "-f", "webm",
    "-loglevel", "error",
    "pipe:1",
  ], { stdio: [fromUrl ? "ignore" : "pipe", "pipe", "pipe"] });

  let tornDown = false;

  // Ending rather than destroying with the error: discord-player's demuxable fast path only pipes this stream, so an "error" event here has no listener and would take the process down. EOF reads as a finished track and lets the queue advance.
  const fail = (why) => {
    if (tornDown) return;
    tornDown = true;
    logger.error(`[MusicStream] ffmpeg remux aborted, ${why}`);
    if (!child.killed) child.kill("SIGKILL");
    child.stdout.push(null);
  };

  if (!fromUrl) {
    source.pipe(child.stdin);
    source.on("error", err => fail(`the source stream died: ${err.message}`));
    child.stdin.on("error", () => source.destroy());
  }

  let stderr = "";
  child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-STDERR_CAP); });
  child.on("error", err => fail(`failed to spawn: ${err.message}`));
  // As with yt-dlp, teardown makes ffmpeg complain about a failed write, which is our own kill rather than a playback failure.
  child.on("close", code => {
    if (tornDown || code === 0 || !stderr.trim()) return;
    logger.error(`[MusicStream] ffmpeg remux exited ${code}: ${stderr.trim().slice(-300)}`);
  });
  child.stdout.on("close", () => {
    tornDown = true;
    if (!fromUrl) source.destroy();
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
      return toWebmOpus(await createYtdlpStream(youtubeUrl, track));
    }
    // Returning the URL anyway means ffmpeg decodes noise and the track "plays" for a fraction of a second; failing loudly lets the caller say why.
    const reason = `**${track?.title || "That track"}** is DRM-protected at its source, and no playable alternative was found.`;
    noteUnplayable(track, reason);
    throw new UnplayableTrackError(reason);
  }

  logger.debug(`[MusicStream] Remuxing to opus for "${track?.title}"`);
  return { $fmt: StreamType.WebmOpus, stream: remuxToOpus(stream) };
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

// Patched in place so the corrected author also reaches bridgeToYoutube, which searches "title author". Otherwise it looks up "<title> Apple Music".
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

const PLAYLIST_TIMEOUT_MS = 120000;

// spawnSync would halt the event loop for as long as yt-dlp takes, which on this host means the whole bot stops answering for up to two minutes.
function dumpPlaylistJson(url, limit) {
  return new Promise(resolve => {
    const child = spawn(YTDLP, [
      "--flat-playlist", "--dump-single-json",
      "--playlist-end", String(limit),
      "--no-warnings",
      ...NO_DISK,
      ...NETWORK,
      ...JS_RUNTIME,
      ...cookieArgs,
      url,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let done = false;

    const finish = result => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!child.killed) child.kill("SIGKILL");
      resolve(result);
    };

    const timer = setTimeout(() => {
      logger.warn(`[MusicStream] Playlist read timed out for ${url}`);
      finish(null);
    }, PLAYLIST_TIMEOUT_MS);
    if (typeof timer.unref === "function") timer.unref();

    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-STDERR_CAP); });
    child.on("error", err => {
      logger.warn(`[MusicStream] yt-dlp could not be run for playlist ${url}: ${err.message}`);
      finish(null);
    });
    child.on("close", code => {
      if (code !== 0) {
        logger.warn(`[MusicStream] yt-dlp could not read playlist ${url}: ${stderr.trim().slice(-200)}`);
        return finish(null);
      }
      finish(stdout);
    });
  });
}

// The extractor resolves a playlist's title but returns zero tracks, so the
// entries are read from yt-dlp instead. One call yields every entry's metadata,
// which is far cheaper than searching each video individually.
async function expandYoutubePlaylist(url, player, requestedBy, limit = PLAYLIST_LIMIT) {
  const stdout = await dumpPlaylistJson(url, limit);
  if (!stdout) return [];

  let parsed;
  try {
    parsed = JSON.parse(stdout);
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

module.exports = { noteUnplayableReason: noteUnplayable, enrichAppleMusicTracks, enrichAppleMusicTrack, appleTrackId, isAppleMusicTrack, beforeCreateStream, afterStreamExtracted, UnplayableTrackError, takeUnplayableReason, isDrmProtected, bridgeToYoutube, remuxToOpus, toWebmOpus, createYtdlpStream, ytdlpAttempts, logYtdlpDiagnostics, shouldUseYtdlp, isYoutubePlaylist, expandYoutubePlaylist, formatDuration, YTDLP, FORMAT, JS_FREE_CLIENTS, PLAYLIST_LIMIT, NO_DISK, NETWORK, FIRST_BYTE_TIMEOUT_MS };
