// Pure formatting and timing helpers for the now-playing panel and the queue command.
// Separate from panelManager.js so the panel renderer can use them without requiring
// the player that requires the renderer.

// Fallback when a track's duration is unknown, which bridged sources report as 0.
const DEFAULT_COLLECTOR_MS = 600000;
const QUEUE_STRING_MAX = 3584;
const QUEUE_PAGE_SIZE = 10;

// getTimestamp() is null until playback resolves (bridged Spotify reaches PlayerStart first), and `current` is {label,value} in ms, not seconds.
function remainingMs(queue, track) {
  const elapsed = queue.node.getTimestamp()?.current?.value ?? 0;
  const total = Number(track?.durationMS) || 0;
  const remaining = total - elapsed;
  return remaining > 0 ? remaining : DEFAULT_COLLECTOR_MS;
}

// createProgressBar() also returns null before playback resolves.
function progressBar(queue, track) {
  if (track?.isStream) return "🔴 LIVE";
  const bar = queue.node.createProgressBar();
  return bar ? `🔘 ${bar} 🔘` : "";
}

function formatClock(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

// A drawn bar on a surface that never refreshes is a lie within seconds, so /np gets
// a timestamp that is merely stale instead of a position that is actively wrong.
function staticProgress(queue, track) {
  if (track?.isStream) return "🔴 LIVE";
  const elapsed = queue?.node?.getTimestamp?.()?.current?.value ?? 0;
  const total = Number(track?.durationMS) || 0;
  if (!total) return "";
  return `\`${formatClock(elapsed)} / ${formatClock(total)}\` (at the time this was posted)`;
}

function trackArray(tracks) {
  if (!tracks) return [];
  if (Array.isArray(tracks)) return tracks;
  if (typeof tracks.toArray === "function") return tracks.toArray();
  if (Array.isArray(tracks.data)) return tracks.data;
  if (typeof tracks.map === "function") return tracks.map(t => t);
  return [];
}

function totalDurationMs(tracks) {
  return trackArray(tracks).reduce((sum, t) => sum + (Number(t?.durationMS) || 0), 0);
}

function trackLine(track, position) {
  const title = track?.title || "Unknown track";
  const author = track?.author || "Unknown";
  const duration = track?.duration || "?:??";
  const label = track?.url ? `[${title}](${track.url})` : `**${title}**`;
  return `**${position}.** ${label} by **${author}** (${duration})`;
}

// Returns the page plus the counts the caller needs to label it, so an empty queue
// renders as a sentence rather than the empty string EmbedBuilder rejects outright.
function queuePage(tracks, page = 1, perPage = QUEUE_PAGE_SIZE) {
  const all = trackArray(tracks);
  const pages = Math.max(1, Math.ceil(all.length / perPage));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (current - 1) * perPage;
  const slice = all.slice(start, start + perPage);

  const text = slice.length
    ? slice.map((track, i) => trackLine(track, start + i + 1)).join("\n")
    : "Nothing queued. Whatever is playing now is the last of it.";

  return { text, page: current, pages, total: all.length, durationMs: totalDurationMs(all) };
}

function queueString(tracks) {
  const all = trackArray(tracks);
  if (!all.length) return "Nothing queued. Whatever is playing now is the last of it.";

  let result = all.map((track, i) => trackLine(track, i + 1)).join("\n");

  if (result.length > QUEUE_STRING_MAX) {
    result = result.substring(0, QUEUE_STRING_MAX);
    result = result.substring(0, result.lastIndexOf("\n"));
    result += "\n...";
  }

  return result;
}

module.exports = {
  remainingMs, progressBar, queueString, queuePage, staticProgress,
  formatClock, totalDurationMs, trackArray,
  DEFAULT_COLLECTOR_MS, QUEUE_PAGE_SIZE,
};
