// The passthrough decision, which is the entire reason the player was replaced.
//
// A YouTube track with an opus rendition is already 48kHz stereo in 20ms frames. Tagging it
// WebmOpus lets the voice layer hand those frames to Discord without decoding them. Anything
// that forces a decode costs a second lossy generation, which is what smeared bass before.

jest.mock("../../utils/logger", () => ({
  log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn(),
}));

jest.mock("../../utils/music/stream", () => ({
  beforeCreateStream: jest.fn(),
  afterStreamExtracted: jest.fn(),
  remuxToOpus: jest.fn(s => ({ remuxed: s })),
  isDrmProtected: jest.fn(() => false),
  bridgeToYoutube: jest.fn(),
  createYtdlpStream: jest.fn(),
  UnplayableTrackError: class extends Error {},
  noteUnplayableReason: jest.fn(),
}));

const { StreamType } = require("discord-voip");
const musicStream = require("../../utils/music/stream");
const { PassThrough } = require("stream");
const { resolvePlayable, filterChain } = require("../../utils/music/resolve");

const track = { title: "Song", url: "https://youtube.com/watch?v=abc" };
const fakeStream = { fake: "stream" };
// The filter path pipes for real, so that one test needs an actual stream.
const realStream = () => new PassThrough();

beforeEach(() => jest.clearAllMocks());

describe("resolvePlayable", () => {
  test("passes native opus straight through, with no ffmpeg in the path", async () => {
    musicStream.beforeCreateStream.mockResolvedValue({ $fmt: StreamType.WebmOpus, stream: fakeStream });

    const result = await resolvePlayable(track, { player: {}, filters: [] });

    expect(result.type).toBe(StreamType.WebmOpus);
    expect(result.passthrough).toBe(true);
    // The stream must be the untouched source: anything wrapping it is a decode.
    expect(result.stream).toBe(fakeStream);
  });

  test("a filter gives up passthrough, because filtering means a real decode", async () => {
    const source = realStream();
    musicStream.beforeCreateStream.mockResolvedValue({ $fmt: StreamType.WebmOpus, stream: source });

    const result = await resolvePlayable(track, { player: {}, filters: ["bassboost"] });

    expect(result.passthrough).toBe(false);
    expect(result.stream).not.toBe(source);
    result.stream.destroy();
  });

  test("falls back to the extractor for sources yt-dlp does not handle", async () => {
    musicStream.beforeCreateStream.mockResolvedValue(null);
    musicStream.afterStreamExtracted.mockResolvedValue({ $fmt: StreamType.WebmOpus, stream: fakeStream });
    const extractor = { stream: jest.fn().mockResolvedValue("https://cdn.example/audio") };

    const result = await resolvePlayable({ ...track, extractor }, { player: {}, filters: [] });

    expect(extractor.stream).toHaveBeenCalled();
    expect(result.type).toBe(StreamType.WebmOpus);
    // Not passthrough: only yt-dlp can confirm the source was actually an opus rendition.
    expect(result.passthrough).toBe(false);
  });

  test("re-bridges DRM-protected audio to YouTube rather than decoding noise", async () => {
    musicStream.beforeCreateStream.mockResolvedValue(null);
    musicStream.isDrmProtected.mockReturnValue(true);
    musicStream.bridgeToYoutube.mockResolvedValue("https://youtube.com/watch?v=bridged");
    musicStream.createYtdlpStream.mockResolvedValue({ stream: fakeStream, opus: true });
    const extractor = { stream: jest.fn().mockResolvedValue("https://cdn.example/cbcs/x.m3u8") };

    const result = await resolvePlayable({ ...track, extractor }, { player: {}, filters: [] });

    expect(musicStream.bridgeToYoutube).toHaveBeenCalled();
    expect(result.passthrough).toBe(true);
    expect(result.stream).toBe(fakeStream);
  });

  test("throws rather than returning a silent dead stream when nothing is playable", async () => {
    musicStream.beforeCreateStream.mockResolvedValue(null);

    await expect(resolvePlayable({ ...track, extractor: null }, { player: {}, filters: [] }))
      .rejects.toThrow();
    expect(musicStream.noteUnplayableReason).toHaveBeenCalled();
  });
});

describe("filterChain", () => {
  test("builds a comma-joined ffmpeg chain from filter names", () => {
    expect(filterChain(["bassboost"])).toContain("bass=");
    expect(filterChain(["bassboost", "nightcore"])).toContain(",");
  });

  test("drops names that are not real filters instead of emitting a broken chain", () => {
    expect(filterChain(["definitely_not_a_filter"])).toBe("");
  });
});
