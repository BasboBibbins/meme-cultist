// One guild's playback: voice connection, queue, and audio player.
//
// Shaped to match the subset of discord-player's GuildQueue that the panel, controls, guards,
// and commands already read (`node`, `tracks`, `currentTrack`, `filters.ffmpeg`, `metadata`),
// so swapping the player underneath them left those files alone.

const {
  createAudioPlayer, createAudioResource, joinVoiceChannel, entersState,
  AudioPlayerStatus, VoiceConnectionStatus, NoSubscriberBehavior,
} = require("discord-voip");
const { QueueRepeatMode, AudioFilters } = require("discord-player");
// AudioFilters is a class; the name-to-ffmpeg-expression map hangs off it as a static.
const FILTER_EXPRESSIONS = AudioFilters.filters ?? {};
const logger = require("../logger");
const { TrackStore } = require("./trackStore");
const { resolvePlayable } = require("./resolve");
const { takeUnplayableReason } = require("./stream");

const LEAVE_ON_END_MS = 60000;
const LEAVE_ON_EMPTY_MS = 300000;
const CONNECT_TIMEOUT_MS = 20000;
// A reconnect that has not resolved by now is a move or a kick rather than a blip.
const REJOIN_GRACE_MS = 5000;
const PROGRESS_CELLS = 20;

function clockOf(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

class MusicSession {
  constructor(engine, guild, options = {}) {
    this.engine = engine;
    this.guild = guild;
    this.metadata = options.metadata ?? {};
    this.tracks = new TrackStore();
    this.currentTrack = null;
    this.repeatMode = QueueRepeatMode.OFF;

    this.connection = null;
    this.channel = null;
    this.resource = null;
    this.deleted = false;

    this._enabledFilters = [];
    this._idleTimer = null;
    this._emptyTimer = null;
    this._starting = false;

    this.audioPlayer = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    this.audioPlayer.on("error", error => {
      logger.error(`[Music] Audio player error in ${guild?.name}: ${error.message}`);
      error.selfAdvancing = true;
      this.engine.emit("playerError", this, error, this.currentTrack);
      this._advance("error").catch(() => {});
    });

    this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
      if (this.deleted || this._starting) return;
      this._advance("finished").catch(err => logger.error(`[Music] Advance failed: ${err.message}`));
    });

    this.node = this._buildNode();
    this.filters = this._buildFilters();
  }

  get player() {
    return this.engine;
  }

  // discord-player exposed this; the panel reads it to decide whether to keep refreshing.
  isPlaying() {
    return this.audioPlayer.state.status === AudioPlayerStatus.Playing
      || this.audioPlayer.state.status === AudioPlayerStatus.Buffering;
  }

  async connect(voiceChannel) {
    this.channel = voiceChannel;
    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      // Discord reports a channel move as a disconnect, so wait to see which it was before tearing down.
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, REJOIN_GRACE_MS),
          entersState(this.connection, VoiceConnectionStatus.Connecting, REJOIN_GRACE_MS),
        ]);
      } catch {
        logger.warn(`[Music] Disconnected from voice in ${this.guild?.name}`);
        this.engine.emit("disconnect", this);
        this.delete();
      }
    });

    this.connection.subscribe(this.audioPlayer);
    await entersState(this.connection, VoiceConnectionStatus.Ready, CONNECT_TIMEOUT_MS);
    return this.connection;
  }

  addTrack(track) {
    const many = Array.isArray(track);
    this.tracks.add(track);
    this._clearTimers();
    if (many) this.engine.emit("audioTracksAdd", this, track);
    else this.engine.emit("audioTrackAdd", this, track);
    return this;
  }

  // "Start if idle", which is how every caller uses it. Guarding on currentTrack rather than
  // isPlaying() matters: a paused session still owns a track, and treating it as idle would
  // abandon that track and start the next one instead of doing nothing.
  async play() {
    if (this._starting || this.currentTrack) return;
    return this._advance("start");
  }

  async _advance(reason) {
    if (this.deleted) return;

    const finished = this.currentTrack;
    if (finished && reason !== "start") this.engine.emit("playerFinish", this, finished);

    // TRACK repeat replays the same track rather than pulling a new one.
    const next = this.repeatMode === QueueRepeatMode.TRACK && finished && reason === "finished"
      ? finished
      : this.tracks.shift();

    if (!next) {
      this.currentTrack = null;
      this.engine.emit("emptyQueue", this);
      this._scheduleLeave();
      return;
    }

    await this._start(next);
  }

  async _start(track) {
    this._starting = true;
    this._clearTimers();
    try {
      // WillPlayTrack blocks in discord-player, and bot.js still listens for it, so the shape is kept.
      await new Promise(resolve => {
        if (!this.engine.emit("willPlayTrack", this, track, {}, resolve)) resolve();
      });

      const { stream, type, passthrough } = await resolvePlayable(track, {
        player: this.engine.searchPlayer,
        filters: this._enabledFilters,
      });

      logger.debug(`[Music] Audio path for "${track.title}": ${passthrough ? "opus passthrough (no decode, no re-encode)" : `${type} through ffmpeg`}`);

      // inlineVolume stays off: enabling it re-encodes every frame and throws the passthrough away.
      this.resource = createAudioResource(stream, { inputType: type, inlineVolume: false });
      this.currentTrack = track;
      this.audioPlayer.play(this.resource);

      await entersState(this.audioPlayer, AudioPlayerStatus.Playing, CONNECT_TIMEOUT_MS);
      this.engine.emit("playerStart", this, track);
    } catch (error) {
      this.currentTrack = null;
      const unplayable = takeUnplayableReason(track);
      logger.error(`[Music] Could not start "${track?.title}": ${error.message}`);
      // Flagged because the handler in bot.js decides whether to skip, and this path already advances.
      const reported = unplayable ? Object.assign(new Error(unplayable), { unplayable: true }) : error;
      reported.selfAdvancing = true;
      this.engine.emit("playerError", this, reported, track);
      this._starting = false;
      return this._advance("error");
    } finally {
      this._starting = false;
    }
  }

  _scheduleLeave() {
    this._clearTimers();
    this._idleTimer = setTimeout(() => {
      logger.debug(`[Music] Nothing queued for ${LEAVE_ON_END_MS}ms in ${this.guild?.name}, leaving.`);
      this.delete();
    }, LEAVE_ON_END_MS);
    if (typeof this._idleTimer.unref === "function") this._idleTimer.unref();
  }

  // Called by the engine when the voice channel empties out.
  scheduleEmptyLeave() {
    if (this._emptyTimer) return;
    this._emptyTimer = setTimeout(() => this.delete(), LEAVE_ON_EMPTY_MS);
    if (typeof this._emptyTimer.unref === "function") this._emptyTimer.unref();
  }

  cancelEmptyLeave() {
    if (this._emptyTimer) clearTimeout(this._emptyTimer);
    this._emptyTimer = null;
  }

  _clearTimers() {
    if (this._idleTimer) clearTimeout(this._idleTimer);
    this._idleTimer = null;
    this.cancelEmptyLeave();
  }

  setRepeatMode(mode) {
    this.repeatMode = mode;
    return this;
  }

  delete() {
    if (this.deleted) return;
    this.deleted = true;
    this._clearTimers();
    this.tracks.clear();
    this.currentTrack = null;
    try { this.audioPlayer.stop(true); } catch { /* already gone */ }
    try { this.connection?.destroy(); } catch { /* already gone */ }
    this.connection = null;
    this.engine.sessions.delete(this.guild?.id);
  }

  _buildNode() {
    const session = this;
    return {
      isPaused: () => session.audioPlayer.state.status === AudioPlayerStatus.Paused
        || session.audioPlayer.state.status === AudioPlayerStatus.AutoPaused,
      isPlaying: () => session.isPlaying(),
      pause: () => session.audioPlayer.pause(true),
      resume: () => session.audioPlayer.unpause(),
      play: () => session.play(),

      // Returns false when there is nothing to skip, which is what /skip reports on.
      skip: () => {
        if (!session.currentTrack) return false;
        const previous = session.currentTrack;
        // Repeat would otherwise replay the track being skipped.
        const mode = session.repeatMode;
        session.repeatMode = QueueRepeatMode.OFF;
        session.audioPlayer.stop(true);
        session.repeatMode = mode === QueueRepeatMode.TRACK ? QueueRepeatMode.OFF : mode;
        session.engine.emit("playerSkip", session, previous, "MANUAL", "The track was skipped manually");
        return true;
      },

      stop: () => {
        session.tracks.clear();
        session.currentTrack = null;
        session.audioPlayer.stop(true);
        session._scheduleLeave();
        return true;
      },

      remove: resolvable => session.tracks.remove(resolvable),

      // Only meaningful when something is re-encoding; passthrough has no encoder to configure.
      setBitrate: () => undefined,

      getTimestamp: () => {
        if (!session.resource || !session.currentTrack) return null;
        const current = session.resource.playbackDuration ?? 0;
        const total = Number(session.currentTrack.durationMS) || 0;
        return {
          current: { label: clockOf(current), value: current },
          total: { label: clockOf(total), value: total },
          progress: total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0,
        };
      },

      createProgressBar: () => {
        const stamp = session.node.getTimestamp();
        if (!stamp || stamp.total.value <= 0) return null;
        const filled = Math.min(PROGRESS_CELLS, Math.round((stamp.current.value / stamp.total.value) * PROGRESS_CELLS));
        return `${"▬".repeat(filled)}🔘${"▬".repeat(Math.max(0, PROGRESS_CELLS - filled))} ${stamp.current.label} / ${stamp.total.label}`;
      },
    };
  }

  _buildFilters() {
    const session = this;
    const ffmpeg = {
      getFiltersEnabled: () => [...session._enabledFilters],
      isEnabled: name => session._enabledFilters.includes(name),
      get args() {
        return session._enabledFilters;
      },
      // Changing the chain rebuilds the ffmpeg pass, so the track restarts from the top.
      toggle: async names => {
        const list = Array.isArray(names) ? names : [names];
        for (const name of list) {
          if (!FILTER_EXPRESSIONS[name]) continue;
          const at = session._enabledFilters.indexOf(name);
          if (at >= 0) session._enabledFilters.splice(at, 1);
          else session._enabledFilters.push(name);
        }
        if (session.currentTrack) {
          const track = session.currentTrack;
          session.audioPlayer.stop(true);
          await session._start(track);
        }
        return session._enabledFilters;
      },
    };
    return { ffmpeg };
  }
}

module.exports = { MusicSession };
