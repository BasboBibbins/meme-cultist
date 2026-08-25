// Replaces discord-player's playback engine while keeping its search.
//
// discord-player 7.2.0 decodes and re-encodes opus unless all eight of its DSP stages are
// disabled, and disabling them truncates playback a frame in, so there is no setting at which
// it both plays and preserves the source. Its extractors are still the best way to resolve a
// Spotify, Apple, or SoundCloud link into metadata, so the library stays for that and nothing else.
//
// Exposes the `nodes.get` / `events.on` / `search` shape the rest of the bot already calls.

const { EventEmitter } = require("events");
const { Collection } = require("discord.js");
const logger = require("../logger");
const { MusicSession } = require("./session");

class MusicEngine extends EventEmitter {
  // searchPlayer is a discord-player Player used only for search, metadata, and extractor streams.
  constructor(client, searchPlayer) {
    super();
    // A guild can queue faster than a track can fail, and an unhandled "error" would take the process down.
    this.setMaxListeners(0);
    this.client = client;
    this.searchPlayer = searchPlayer;
    // A Collection rather than a Map: discord-player exposed this as one, and callers use
    // its helpers (bot.js asks nodes.cache.some(...) whether anything is playing).
    this.sessions = new Collection();

    const sessions = this.sessions;
    this.nodes = {
      get: guildId => sessions.get(guildId) ?? null,
      create: (guild, options) => this.create(guild, options),
      delete: guildId => sessions.get(guildId)?.delete(),
      get cache() {
        return sessions;
      },
    };

    // bot.js listens through `player.events`, which was a separate emitter on discord-player.
    this.events = this;
  }

  get extractors() {
    return this.searchPlayer.extractors;
  }

  create(guild, options = {}) {
    const existing = this.sessions.get(guild.id);
    if (existing && !existing.deleted) {
      // Later /play calls should report into the channel they were typed in.
      if (options.metadata) existing.metadata = options.metadata;
      return existing;
    }
    const session = new MusicSession(this, guild, options);
    this.sessions.set(guild.id, session);
    return session;
  }

  search(query, options) {
    return this.searchPlayer.search(query, options);
  }

  // Mirrors discord-player's own teardown so the Disconnect handler in bot.js still reads sensibly.
  destroy() {
    for (const session of [...this.sessions.values()]) session.delete();
    this.sessions.clear();
  }

  // Voice state drives the leave-when-empty timer; discord-player owned this internally.
  handleVoiceStateUpdate(oldState, newState) {
    const guildId = oldState.guild?.id ?? newState.guild?.id;
    const session = this.sessions.get(guildId);
    if (!session?.channel) return;

    const channel = session.guild?.channels?.cache?.get(session.channel.id);
    if (!channel) return;

    const humans = channel.members.filter(member => !member.user.bot).size;
    if (humans === 0) {
      logger.debug(`[Music] Voice channel empty in ${session.guild?.name}, starting the leave timer.`);
      session.scheduleEmptyLeave();
    } else {
      session.cancelEmptyLeave();
    }
  }
}

module.exports = { MusicEngine };
