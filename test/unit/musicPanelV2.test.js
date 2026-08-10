// Components V2 now-playing panel: a pure builder, so the whole tree is assertable without a voice connection.

jest.mock("../../utils/logger", () => ({
  log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn(),
}));

const { MessageFlags } = require("discord.js");
const { buildNowPlayingV2, isUsableUrl } = require("../../utils/musicPanelV2");

const TRACK = {
  title: "One More Time",
  url: "https://youtube.com/watch?v=x",
  author: "Daft Punk",
  views: 1234567,
  thumbnail: "https://example.com/art.jpg",
  isStream: false,
};

const queueWith = ({ next = null, bar = "▬▬🔘▬▬", channelName = "General" } = {}) => ({
  channel: channelName ? { name: channelName } : null,
  tracks: { at: () => next },
  node: { createProgressBar: () => bar, getTimestamp: () => ({ current: { value: 1000 } }) },
});

const build = (overrides = {}) => buildNowPlayingV2({
  track: TRACK,
  queue: queueWith(),
  requestedBy: { displayName: "basbo" },
  client: { user: { username: "Fwen Bot" } },
  ...overrides,
});

const json = payload => payload.components[0].toJSON();
const textOf = payload => JSON.stringify(json(payload));

describe("buildNowPlayingV2", () => {
  test("returns a container carrying the Components V2 flag", () => {
    const payload = build();
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(json(payload).type).toBe(17);
  });

  // A V2 message cannot carry embeds or content; sending either alongside is rejected.
  test("returns no embeds or content", () => {
    const payload = build();
    expect(payload.embeds).toBeUndefined();
    expect(payload.content).toBeUndefined();
  });

  test("renders the track, artist and channel in the header", () => {
    const body = textOf(build());
    expect(body).toContain("Now Playing in General");
    expect(body).toContain("One More Time");
    expect(body).toContain("Daft Punk");
  });

  test("attaches album art as a section accessory", () => {
    const section = json(build()).components.find(c => c.type === 9);
    expect(section.accessory.media.url).toBe(TRACK.thumbnail);
  });

  // ThumbnailBuilder needs a real URL; bridged tracks sometimes carry none.
  test("falls back to a plain text block when there is no usable artwork", () => {
    const payload = build({ track: { ...TRACK, thumbnail: "" } });
    const types = json(payload).components.map(c => c.type);
    expect(types).not.toContain(9);
    expect(textOf(payload)).toContain("One More Time");
  });

  test("omits Up Next when nothing is queued", () => {
    expect(textOf(build())).not.toContain("Up Next");
  });

  test("shows Up Next when a track follows", () => {
    const next = { title: "Aerodynamic", url: "https://y", author: "Daft Punk" };
    expect(textOf(build({ queue: queueWith({ next }) }))).toContain("Aerodynamic");
  });

  test("flips the heading and controls when paused", () => {
    const body = textOf(build({ paused: true }));
    expect(body).toContain("Song Paused");
    expect(body).toContain("Resume");
  });

  test("keeps the control ids the collector listens for", () => {
    const row = json(build()).components.find(c => c.type === 1);
    expect(row.components.map(b => b.custom_id)).toEqual(["pause", "skip", "stop"]);
  });

  test("carries the requester and version the embed footer used to", () => {
    const body = textOf(build());
    expect(body).toContain("Requested by basbo");
    expect(body).toContain("Fwen Bot");
  });

  test("survives a track with no views, duration or channel name", () => {
    const payload = build({
      track: { title: "x", url: "https://x", author: "y", views: 0, thumbnail: "" },
      queue: queueWith({ channelName: null, bar: null }),
    });
    expect(() => json(payload)).not.toThrow();
    expect(textOf(payload)).not.toContain("views");
  });

  test("labels a live stream instead of drawing a progress bar", () => {
    const payload = build({ track: { ...TRACK, isStream: true } });
    expect(textOf(payload)).toContain("LIVE");
  });
});

describe("isUsableUrl", () => {
  test("accepts http and https only", () => {
    expect(isUsableUrl("https://example.com/a.jpg")).toBe(true);
    expect(isUsableUrl("http://example.com/a.jpg")).toBe(true);
    expect(isUsableUrl("attachment://a.jpg")).toBe(false);
    expect(isUsableUrl("")).toBe(false);
    expect(isUsableUrl(null)).toBe(false);
  });
});
