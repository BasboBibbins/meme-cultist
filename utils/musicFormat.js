// Pure formatting and timing helpers for the now-playing panel and the queue command.
// Separate from musicPlayer.js so the panel renderer can use them without requiring
// the player that requires the renderer.

// Fallback when a track's duration is unknown, which bridged sources report as 0.
const DEFAULT_COLLECTOR_MS = 600000;
const QUEUE_STRING_MAX = 3584;

// getTimestamp() is null until playback resolves (bridged Spotify reaches PlayerStart first), and `current` is {label,value} in ms — not seconds.
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

function queueString(tracks) {
  let result = tracks.map((track, i) =>
    `**${i + 1}.** [${track.title}](${track.url}) by **${track.author}** - ${track.duration}`
  ).join("\n");

  if (result.length > QUEUE_STRING_MAX) {
    result = result.substring(0, QUEUE_STRING_MAX);
    result = result.substring(0, result.lastIndexOf("\n"));
    result += "\n...";
  }

  return result;
}

module.exports = { remainingMs, progressBar, queueString, DEFAULT_COLLECTOR_MS };
