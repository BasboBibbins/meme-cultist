// Components V2 now-playing panel: a pure builder, so the whole tree is assertable without a voice connection.

jest.mock("../../utils/logger", () => ({
  log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn(),
}));

const { MessageFlags, ButtonStyle } = require("discord.js");
const { buildNowPlayingV2, isUsableUrl } = require("../../utils/musicPanelV2");

const TRACK = {
  title: "One More Time",
  url: "https://youtube.com/watch?v=x",
  author: "Daft Punk",
  views: 1234567,
  thumbnail: "https://example.com/art.jpg",
  isStream: false,
};

const queueWith = ({ next = null, bar = "▬▬🔘▬▬", channelName = "General", filters = [] } = {}) => ({
  channel: channelName ? { name: channelName } : null,
  tracks: { at: () => next },
  filters: { ffmpeg: { getFiltersEnabled: () => filters } },
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

// The heading lives in the first text display, whether or not it sits in a section.
const headingOf = payload => {
  const first = json(payload).components[0];
  const text = first.type === 9 ? first.components[0].content : first.content;
  return text.split("\n")[0];
};

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
    expect(row.components.map(b => b.custom_id)).toEqual(["pause", "skip", "loop", "stop"]);
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

describe("loop control", () => {
  const controlsOf = payload => json(payload).components.find(c => c.type === 1).components;
  const loopButton = payload => controlsOf(payload).find(b => b.custom_id === "loop");

  test("adds a loop control alongside the existing ones", () => {
    expect(controlsOf(build()).map(b => b.custom_id)).toEqual(["pause", "skip", "loop", "stop"]);
  });

  test("reads as off by default", () => {
    const button = loopButton(build());
    expect(button.label).toBe("Loop");
    expect(button.style).toBe(ButtonStyle.Secondary);
  });

  // Label alone is ambiguous at a glance, so the style carries the state too.
  test("switches label and style when looping", () => {
    const button = loopButton(build({ looping: true }));
    expect(button.label).toBe("Looping");
    expect(button.style).toBe(ButtonStyle.Success);
  });

  // Asserted on the heading alone: the loop button carries a 🔁 emoji, so searching the whole payload would match either way.
  test("marks the heading so the state is visible without reading the button", () => {
    expect(headingOf(build({ looping: true }))).toContain("🔁");
    expect(headingOf(build({ looping: false }))).not.toContain("🔁");
  });

  test("shows loop state while paused too", () => {
    const body = textOf(build({ looping: true, paused: true }));
    expect(body).toContain("Song Paused");
    expect(body).toContain("🔁");
  });

  // Looping repeats the current track without consuming the queue, so Up Next must keep showing what follows once the loop is switched off.
  test("still shows Up Next while looping", () => {
    const next = { title: "Aerodynamic", url: "https://y", author: "Daft Punk" };
    expect(textOf(build({ queue: queueWith({ next }), looping: true }))).toContain("Aerodynamic");
  });
});

// /np reuses this renderer but has no collector, so buttons there would look interactive and do nothing.
describe("controls: false", () => {
  test("omits the action row entirely", () => {
    const types = json(build({ controls: false })).components.map(c => c.type);
    expect(types).not.toContain(1);
  });

  test("keeps everything else the panel shows", () => {
    const next = { title: "Aerodynamic", url: "https://y", author: "Daft Punk" };
    const body = textOf(build({ controls: false, looping: true, queue: queueWith({ next, filters: ["bassboost"] }) }));
    expect(body).toContain("One More Time");
    expect(body).toContain("Aerodynamic");
    expect(body).toContain("bassboost");
    expect(headingOf(build({ controls: false, looping: true }))).toContain("🔁");
  });
});

describe("active filters", () => {
  test("lists every enabled ffmpeg filter", () => {
    const body = textOf(build({ queue: queueWith({ filters: ["bassboost", "nightcore"] }) }));
    expect(body).toContain("Filters:");
    expect(body).toContain("bassboost");
    expect(body).toContain("nightcore");
  });

  test("omits the line entirely when nothing is enabled", () => {
    expect(textOf(build({ queue: queueWith({ filters: [] }) }))).not.toContain("Filters:");
  });

  // The panel must not break on a queue shape lacking the filters API.
  test("degrades quietly when the filters API is absent", () => {
    const queue = queueWith();
    delete queue.filters;
    expect(() => build({ queue })).not.toThrow();
    expect(textOf(build({ queue }))).not.toContain("Filters:");
  });

  test("ignores non-string entries rather than rendering them", () => {
    const body = textOf(build({ queue: queueWith({ filters: ["bassboost", null, "", 7] }) }));
    expect(body).toContain("bassboost");
    expect(body).not.toContain("null");
  });

  test("survives a filters accessor that throws", () => {
    const queue = queueWith();
    queue.filters = { ffmpeg: { getFiltersEnabled: () => { throw new Error("not ready"); } } };
    expect(() => build({ queue })).not.toThrow();
  });

  test("still lists filters while paused", () => {
    const body = textOf(build({ queue: queueWith({ filters: ["vaporwave"] }), paused: true }));
    expect(body).toContain("vaporwave");
    expect(body).toContain("Song Paused");
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
