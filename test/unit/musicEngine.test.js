// The engine that replaced discord-player's player. The contract worth pinning is the one
// that broke: opus reaches Discord as opus, and the session still looks like the GuildQueue
// the panel, controls, and commands were written against.

jest.mock("../../utils/logger", () => ({
  log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn(),
}));

const { TrackStore } = require("../../utils/music/trackStore");
const { MusicEngine } = require("../../utils/music/engine");

// A session owns an audio player whose timer would otherwise outlive the suite.
const engines = [];
const newEngine = (client, searchPlayer) => {
  const engine = new MusicEngine(client, searchPlayer);
  engines.push(engine);
  return engine;
};
afterEach(() => { while (engines.length) engines.pop().destroy(); });

const track = (n, durationMS = 200000) => ({
  title: `Song ${n}`, author: `Artist ${n}`, url: `https://youtube.com/watch?v=${n}`, durationMS,
});

describe("TrackStore", () => {
  test("exposes the shape the panel and commands already read", () => {
    const store = new TrackStore();
    store.add([track(1), track(2), track(3)]);
    expect(store.size).toBe(3);
    expect(store.at(0).title).toBe("Song 1");
    expect(store.toArray()).toHaveLength(3);
    expect(typeof store.shuffle).toBe("function");
  });

  test("removes by track object and by index, which are both used", () => {
    const store = new TrackStore();
    const [a, b, c] = [track(1), track(2), track(3)];
    store.add([a, b, c]);
    expect(store.remove(b).title).toBe("Song 2");
    expect(store.remove(0).title).toBe("Song 1");
    expect(store.size).toBe(1);
    expect(store.at(0).title).toBe("Song 3");
  });

  test("returns null rather than throwing on an out-of-range removal", () => {
    const store = new TrackStore();
    store.add(track(1));
    expect(store.remove(9)).toBeNull();
    expect(store.remove({ title: "not queued" })).toBeNull();
  });

  test("shuffle keeps every track, which a random-comparator sort does not guarantee", () => {
    const store = new TrackStore();
    const titles = Array.from({ length: 50 }, (_, i) => `Song ${i}`);
    store.add(titles.map((t, i) => ({ ...track(i), title: t })));
    store.shuffle();
    expect(store.toArray().map(t => t.title).sort()).toEqual([...titles].sort());
  });

  test("at() past the end is null, so an empty queue renders instead of throwing", () => {
    expect(new TrackStore().at(0)).toBeNull();
  });
});

describe("MusicEngine", () => {
  const guild = { id: "g1", name: "Guild" };
  const searchPlayer = { search: jest.fn().mockResolvedValue({ tracks: [] }), extractors: { store: [] } };

  test("exposes the nodes/events/search surface the rest of the bot calls", () => {
    const engine = newEngine({}, searchPlayer);
    expect(typeof engine.nodes.get).toBe("function");
    expect(typeof engine.nodes.create).toBe("function");
    expect(typeof engine.events.on).toBe("function");
    expect(typeof engine.search).toBe("function");
    expect(engine.extractors).toBe(searchPlayer.extractors);
  });

  test("nodes.get returns null for a guild with no session, which the guards branch on", () => {
    expect(newEngine({}, searchPlayer).nodes.get("nope")).toBeNull();
  });

  test("reuses one session per guild rather than orphaning the first", () => {
    const engine = newEngine({}, searchPlayer);
    const a = engine.create(guild, { metadata: { requestedBy: "u1" } });
    const b = engine.create(guild, { metadata: { requestedBy: "u2" } });
    expect(b).toBe(a);
    // A later /play should report into the channel it was typed in.
    expect(a.metadata.requestedBy).toBe("u2");
  });

  test("a deleted session is replaced rather than resurrected", () => {
    const engine = newEngine({}, searchPlayer);
    const first = engine.create(guild, {});
    first.delete();
    expect(engine.create(guild, {})).not.toBe(first);
  });

  test("search delegates to discord-player, which is kept only for that", async () => {
    const engine = newEngine({}, searchPlayer);
    await engine.search("query", { opt: 1 });
    expect(searchPlayer.search).toHaveBeenCalledWith("query", { opt: 1 });
  });
});

describe("session facade", () => {
  const guild = { id: "g2", name: "Guild" };
  const searchPlayer = { search: jest.fn(), extractors: { store: [] } };
  const makeSession = () => newEngine({}, searchPlayer).create(guild, {});

  test("carries the GuildQueue members the untouched files read", () => {
    const s = makeSession();
    for (const key of ["node", "tracks", "filters", "metadata", "currentTrack", "repeatMode", "guild"]) {
      expect(s).toHaveProperty(key);
    }
    for (const fn of ["isPaused", "isPlaying", "pause", "resume", "skip", "stop", "play", "remove", "getTimestamp", "createProgressBar"]) {
      expect(typeof s.node[fn]).toBe("function");
    }
    for (const fn of ["getFiltersEnabled", "isEnabled", "toggle"]) {
      expect(typeof s.filters.ffmpeg[fn]).toBe("function");
    }
  });

  test("getTimestamp is null before playback resolves, which musicFormat already handles", () => {
    expect(makeSession().node.getTimestamp()).toBeNull();
  });

  test("skip refuses when nothing is playing, so /skip can report a wedged queue", () => {
    expect(makeSession().node.skip()).toBe(false);
  });

  test("starts with no filters enabled", () => {
    expect(makeSession().filters.ffmpeg.getFiltersEnabled()).toEqual([]);
  });
});

describe("nodes.cache", () => {
  const searchPlayer = { search: jest.fn(), extractors: { store: [] } };

  // bot.js asks nodes.cache.some(...) whether anything is playing. A plain Map has no .some,
  // which crashed the loop-lag reporter under DEBUG_MODE.
  test("supports the Collection helpers callers use, not just Map methods", () => {
    const engine = newEngine({}, searchPlayer);
    for (const fn of ["some", "filter", "map", "find", "get", "set", "delete"]) {
      expect(typeof engine.nodes.cache[fn]).toBe("function");
    }
    expect(engine.nodes.cache.some(() => true)).toBe(false);
  });

  test("reflects live sessions", () => {
    const engine = newEngine({}, searchPlayer);
    engine.create({ id: "g9", name: "G" }, {});
    expect(engine.nodes.cache.size).toBe(1);
    expect(engine.nodes.cache.some(s => s.guild.id === "g9")).toBe(true);
  });
});

describe("play() is start-if-idle", () => {
  const searchPlayer = { search: jest.fn(), extractors: { store: [] } };

  // A paused session still owns its track. Treating it as idle abandoned that track and
  // started the next one, which is what /pause followed by another /play would have done.
  test("does nothing when a track is already loaded, even while paused", async () => {
    const engine = newEngine({}, searchPlayer);
    const session = engine.create({ id: "g10", name: "G" }, {});
    session.currentTrack = { title: "already playing" };
    const advance = jest.spyOn(session, "_advance");

    await session.play();

    expect(advance).not.toHaveBeenCalled();
    expect(session.currentTrack.title).toBe("already playing");
  });

  test("advances when nothing is loaded", async () => {
    const engine = newEngine({}, searchPlayer);
    const session = engine.create({ id: "g11", name: "G" }, {});
    const advance = jest.spyOn(session, "_advance").mockResolvedValue(undefined);

    await session.play();

    expect(advance).toHaveBeenCalledWith("start");
  });
});
