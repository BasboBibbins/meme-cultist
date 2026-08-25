// The music subsystem. Layered bottom to top:
//
//   poToken  -> mints YouTube's proof-of-origin token
//   stream   -> yt-dlp and ffmpeg: the bytes, plus playlist expansion and source bridging
//   resolve  -> picks a stream for a track and reports whether it can bypass the encoder
//   session  -> one guild's voice connection, queue, and audio player
//   engine   -> the per-guild session registry, events, and search
//
// Above the engine sit the presentation pieces: panel renders the now-playing message,
// panelManager owns its collector and refresh loop, and controls holds the actions both
// the panel buttons and the slash commands call so the two cannot drift apart.
//
// discord-player is still a dependency, but only as a search and metadata resolver. Its
// playback engine decoded and re-encoded opus unless all eight of its DSP stages were off,
// and disabling them truncated playback, so there was no setting at which it both played
// and preserved the source.
//
// Commands import the specific module they need (../../utils/music/guards). This barrel is
// for consumers that want the engine and its lifecycle together, which in practice is bot.js.

const { MusicEngine } = require("./engine");
const { MusicSession } = require("./session");
const { TrackStore } = require("./trackStore");
const { resolvePlayable } = require("./resolve");
const { resolveMusicContext } = require("./guards");
const panelManager = require("./panelManager");

module.exports = {
  MusicEngine,
  MusicSession,
  TrackStore,
  resolvePlayable,
  resolveMusicContext,
  trackStart: panelManager.trackStart,
  trackEnd: panelManager.trackEnd,
  teardownPanel: panelManager.teardownPanel,
  panelChannel: panelManager.panelChannel,
};
