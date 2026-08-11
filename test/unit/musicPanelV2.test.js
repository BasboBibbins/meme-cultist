// Components V2 now-playing panel: a pure builder, so the whole tree is assertable without a voice connection.

jest.mock("../../utils/logger", () => ({
  log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn(),
}));

const { MessageFlags, ButtonStyle } = require("discord.js");
const { buildNowPlayingV2, isUsableUrl, safeText, safeUrl, queueCount } = require("../../utils/musicPanelV2");

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

// Titles and URLs come from external extractors, so they are untrusted input that
// lands inside markdown link syntax.
describe("hostile track metadata", () => {
  // Assertions run against the raw content, not the JSON dump, so a backslash
  // escape reads as one character rather than two.
  const headerTextOf = payload => {
    const first = json(payload).components[0];
    return first.type === 9 ? first.components[0].content : first.content;
  };
  const upNextTextOf = payload =>
    json(payload).components.find(c => c.type === 10 && c.content.startsWith("**Up Next:**")).content;

  test("escapes brackets so a title cannot retarget its own link", () => {
    const header = headerTextOf(build({ track: { ...TRACK, title: "Free Robux](https://evil.example)" } }));
    expect(header).not.toContain("Robux](https://evil.example)");
    expect(header).toContain("Robux\\](https://evil.example)");
    expect(header).toContain("](https://youtube.com/watch?v=x)");
  });

  test("escapes markdown so a title cannot restyle the panel", () => {
    expect(headerTextOf(build({ track: { ...TRACK, title: "**LOUD** _song_" } }))).toContain("\\*\\*LOUD\\*\\*");
  });

  test("percent-encodes parentheses so a url cannot terminate the link early", () => {
    const body = textOf(build({ track: { ...TRACK, url: "https://x.example/a(b)c" } }));
    expect(body).toContain("https://x.example/a%28b%29c");
  });

  test("truncates a very long title instead of blowing the message budget", () => {
    const body = textOf(build({ track: { ...TRACK, title: "z".repeat(600) } }));
    expect(body).toContain("…");
    expect(body).not.toContain("z".repeat(200));
  });

  test("collapses newlines in a title rather than breaking the layout", () => {
    expect(safeText("one\ntwo   three", 80)).toBe("one two three");
  });

  // The old `[title](${url ?? ""})` produced a literal "[title]()" for bridged
  // tracks that report no url.
  test("renders bold text, not an empty link, when the url is missing", () => {
    const body = textOf(build({ track: { ...TRACK, url: null } }));
    expect(body).not.toContain("]()");
    expect(body).toContain("**One More Time**");
  });

  test("applies the same protection to the Up Next line", () => {
    const next = { title: "Bad](https://evil.example)", url: null, author: "**x**" };
    const line = upNextTextOf(build({ queue: queueWith({ next }) }));
    expect(line).not.toContain("Bad](https://evil.example)");
    expect(line).toContain("Bad\\](https://evil.example)");
    expect(line).not.toContain("]()");
    expect(line).toContain("\\*\\*x\\*\\*");
  });

  test("safeUrl rejects anything that is not http(s)", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl(null)).toBeNull();
    expect(safeUrl("https://ok.example/a")).toBe("https://ok.example/a");
  });
});

// Stop abandons a queue anyone in the channel helped build, and there is no undo.
describe("stop confirmation", () => {
  const controlsOf = payload => json(payload).components.find(c => c.type === 1).components;

  test("swaps the whole row so no other control sits beside the kill button", () => {
    const ids = controlsOf(build({ confirmStop: true })).map(b => b.custom_id);
    expect(ids).toEqual(["stop_confirm", "stop_cancel"]);
  });

  test("states the stakes and that the action is final", () => {
    const body = textOf(build({ confirmStop: true }));
    expect(body).toContain("Kill the whole thing?");
    expect(body).toContain("no undo");
  });

  test("counts the queued tracks that die with it", () => {
    const queue = queueWith();
    queue.tracks = { at: () => null, size: 12 };
    const payload = build({ queue, confirmStop: true });
    expect(textOf(payload)).toContain("12 queued tracks");
    expect(controlsOf(payload)[0].label).toBe("Kill it (12 queued)");
  });

  test("stays singular for one queued track", () => {
    const queue = queueWith();
    queue.tracks = { at: () => null, size: 1 };
    expect(textOf(build({ queue, confirmStop: true }))).toContain("1 queued track die");
  });

  test("drops the count when nothing is queued behind it", () => {
    const payload = build({ confirmStop: true });
    expect(textOf(payload)).not.toContain("queued track");
    expect(controlsOf(payload)[0].label).toBe("Kill it");
  });

  test("is off by default", () => {
    expect(controlsOf(build()).map(b => b.custom_id)).toEqual(["pause", "skip", "loop", "stop"]);
    expect(textOf(build())).not.toContain("no undo");
  });

  test("never renders on a panel with no collector behind it", () => {
    const types = json(build({ controls: false, confirmStop: true })).components.map(c => c.type);
    expect(types).not.toContain(1);
    expect(textOf(build({ controls: false, confirmStop: true }))).not.toContain("no undo");
  });

  test("keeps the button label inside Discord's 80-character cap", () => {
    const queue = queueWith();
    queue.tracks = { at: () => null, size: 999999 };
    controlsOf(build({ queue, confirmStop: true })).forEach(b => expect(b.label.length).toBeLessThanOrEqual(80));
  });
});

describe("queueCount", () => {
  test("reads the track store however it reports its length", () => {
    expect(queueCount({ tracks: { size: 4 } })).toBe(4);
    expect(queueCount({ tracks: { data: [1, 2] } })).toBe(2);
    expect(queueCount({ tracks: [1, 2, 3] })).toBe(3);
  });

  test("returns zero for a queue shape that reports nothing", () => {
    expect(queueCount({ tracks: { at: () => null } })).toBe(0);
    expect(queueCount({})).toBe(0);
    expect(queueCount(null)).toBe(0);
  });
});
