// Pure routing/detection logic for the stream provider. The DRM check matters most: an undetected protected source decodes as noise and stops after a fraction of a second.

jest.mock("../../utils/logger", () => ({
  log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn(),
}));

const { Equalizer, ChannelProcessor } = require("@discord-player/equalizer");
const { isDrmProtected, shouldUseYtdlp, isYoutubePlaylist, formatDuration, EQUALIZER_BANDS } = require("../../utils/musicStream");

// The bands go straight to the channel processor, which multiplies every sample by bandMultipliers[i]; anything but a plain number yields NaN samples and a silent mix.
describe("EQUALIZER_BANDS", () => {
  test("covers every band the processor indexes", () => {
    expect(EQUALIZER_BANDS).toHaveLength(Equalizer.BAND_COUNT);
  });

  test("is a flat array of finite numbers, not {band, gain} objects", () => {
    for (const value of EQUALIZER_BANDS) {
      expect(typeof value).toBe("number");
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  test("keeps the intended bass lift on the low bands", () => {
    expect(EQUALIZER_BANDS.slice(0, 3)).toEqual([0.15, 0.10, 0.05]);
    expect(EQUALIZER_BANDS.slice(3).every(v => v === 0)).toBe(true);
  });

  test("produces real samples rather than NaN", () => {
    const processor = new ChannelProcessor(EQUALIZER_BANDS);
    for (const sample of [1000, 2000, -1500, 500]) {
      expect(Number.isNaN(processor.processInt(sample))).toBe(false);
    }
  });

  test("the old {band, gain} shape would have produced NaN", () => {
    const processor = new ChannelProcessor([{ band: 0, gain: 0.15 }, { band: 1, gain: 0.10 }]);
    expect(Number.isNaN(processor.processInt(1000))).toBe(true);
  });
});

describe("isDrmProtected", () => {
  test("flags SoundCloud's CBCS-encrypted transcodings", () => {
    expect(isDrmProtected("https://playback.media-streaming.soundcloud.cloud/cbcs/M7yPsUFRgP5T/aac_160k/x/playlist.m3u8")).toBe(true);
  });

  test("flags a FairPlay skd:// key reference", () => {
    expect(isDrmProtected("skd://04b47b577a4459bdacaaacdb4bf93446")).toBe(true);
  });

  test("leaves unprotected SoundCloud transcodings alone", () => {
    expect(isDrmProtected("https://playback.media-streaming.soundcloud.cloud/cWHNerOLlkUq/aac_160k/x/playlist.m3u8")).toBe(false);
  });

  test("does not false-positive on unrelated paths containing similar text", () => {
    expect(isDrmProtected("https://example.com/cbcsomething/audio.m3u8")).toBe(false);
    expect(isDrmProtected("https://example.com/askd/audio.m3u8")).toBe(false);
  });
});

describe("shouldUseYtdlp", () => {
  test("claims YouTube URLs in both forms", () => {
    expect(shouldUseYtdlp("https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(shouldUseYtdlp("https://youtu.be/abc")).toBe(true);
  });

  test("leaves other providers to their own extractor", () => {
    expect(shouldUseYtdlp("https://soundcloud.com/forss/flickermood")).toBe(false);
    expect(shouldUseYtdlp("https://open.spotify.com/track/abc")).toBe(false);
  });

  test("tolerates non-string input", () => {
    for (const bad of [null, undefined, 7, {}]) expect(shouldUseYtdlp(bad)).toBe(false);
  });
});

describe("isYoutubePlaylist", () => {
  test("requires both a YouTube host and a list parameter", () => {
    expect(isYoutubePlaylist("https://www.youtube.com/playlist?list=UU_abc")).toBe(true);
    expect(isYoutubePlaylist("https://www.youtube.com/watch?v=abc&list=PL123")).toBe(true);
    expect(isYoutubePlaylist("https://www.youtube.com/watch?v=abc")).toBe(false);
    expect(isYoutubePlaylist("https://soundcloud.com/x/sets/y?list=1")).toBe(false);
  });
});

describe("formatDuration", () => {
  test("renders m:ss under an hour", () => {
    expect(formatDuration(19)).toBe("0:19");
    expect(formatDuration(203)).toBe("3:23");
  });

  test("renders h:mm:ss at and past an hour", () => {
    expect(formatDuration(3661)).toBe("1:01:01");
  });

  test("falls back to 0:00 for unknown durations, which bridged sources report", () => {
    for (const bad of [0, null, undefined, -5]) expect(formatDuration(bad)).toBe("0:00");
  });
});
