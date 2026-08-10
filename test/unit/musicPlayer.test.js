// Regression cover for the now-playing panel timing math: both helpers read discord-player state that is null until playback resolves.

jest.mock("../../utils/logger", () => ({
  log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn(),
}));

const { remainingMs, progressBar, DEFAULT_COLLECTOR_MS } = require("../../utils/musicPlayer");

const queueWith = (timestamp, bar = "===---") => ({
  node: { getTimestamp: () => timestamp, createProgressBar: () => bar },
});

describe("remainingMs", () => {
  test("subtracts elapsed playback from the track duration", () => {
    const queue = queueWith({ current: { value: 30000 } });
    expect(remainingMs(queue, { durationMS: 210000 })).toBe(180000);
  });

  test("falls back when getTimestamp() is null", () => {
    expect(remainingMs(queueWith(null), { durationMS: 210000 })).toBe(210000);
  });

  test("falls back when the duration is unknown, as bridged tracks report", () => {
    expect(remainingMs(queueWith(null), { durationMS: 0 })).toBe(DEFAULT_COLLECTOR_MS);
  });

  test("never returns a non-positive timeout", () => {
    const queue = queueWith({ current: { value: 500000 } });
    expect(remainingMs(queue, { durationMS: 210000 })).toBe(DEFAULT_COLLECTOR_MS);
  });

  test("survives a missing track without throwing", () => {
    expect(remainingMs(queueWith(null), undefined)).toBe(DEFAULT_COLLECTOR_MS);
  });

  // The original bug: `.current` is {label,value}, so treating it as a number gave NaN for every track and a crash for bridged ones.
  test("never returns NaN", () => {
    for (const ts of [null, { current: { value: 0 } }, { current: {} }, {}]) {
      expect(Number.isNaN(remainingMs(queueWith(ts), { durationMS: 1000 }))).toBe(false);
    }
  });
});

describe("progressBar", () => {
  test("renders the bar once playback has resolved", () => {
    expect(progressBar(queueWith({}, "==---"), { isStream: false })).toBe("🔘 ==--- 🔘");
  });

  test("renders nothing rather than 'null' before playback resolves", () => {
    expect(progressBar(queueWith({}, null), { isStream: false })).toBe("");
  });

  test("labels live streams instead of drawing a bar", () => {
    expect(progressBar(queueWith({}, "==---"), { isStream: true })).toBe("🔴 LIVE");
  });
});
