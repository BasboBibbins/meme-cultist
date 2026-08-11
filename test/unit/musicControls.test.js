// The panel buttons and the slash commands both route through these, so a change here changes both surfaces at once.

jest.mock("../../utils/logger", () => ({
  log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn(),
}));

const { QueueRepeatMode } = require("discord-player");
const {
  isLooping, setLooping, toggleLoop, clearLoop, restoreLoop,
  setPaused, togglePause, skipTrack, stopPlayback,
} = require("../../utils/musicControls");

let guildCounter = 0;

// Each queue gets its own guild id so loop state cannot leak between tests.
function makeQueue({ paused = false, repeatMode = QueueRepeatMode.OFF } = {}) {
  const state = { paused, repeatMode, skipped: 0, stopped: 0 };
  return {
    state,
    guild: { id: `guild-${++guildCounter}` },
    get repeatMode() { return state.repeatMode; },
    setRepeatMode(mode) { state.repeatMode = mode; },
    node: {
      isPaused: () => state.paused,
      pause: async () => { state.paused = true; },
      resume: async () => { state.paused = false; },
      skip: async () => { state.skipped++; return true; },
      stop: async () => { state.stopped++; return true; },
    },
  };
}

describe("loop state", () => {
  test("defaults to off", () => {
    expect(isLooping(makeQueue())).toBe(false);
  });

  test("toggling sets both the intent and the queue repeat mode", () => {
    const queue = makeQueue();
    expect(toggleLoop(queue)).toBe(true);
    expect(isLooping(queue)).toBe(true);
    expect(queue.repeatMode).toBe(QueueRepeatMode.TRACK);

    expect(toggleLoop(queue)).toBe(false);
    expect(queue.repeatMode).toBe(QueueRepeatMode.OFF);
  });

  test("setLooping is explicit rather than a toggle, so /loop enabled:true is idempotent", () => {
    const queue = makeQueue();
    expect(setLooping(queue, true)).toBe(true);
    expect(setLooping(queue, true)).toBe(true);
    expect(isLooping(queue)).toBe(true);
  });

  // Loop state is per guild; one server looping must not affect another.
  test("is tracked per guild", () => {
    const a = makeQueue();
    const b = makeQueue();
    setLooping(a, true);
    expect(isLooping(a)).toBe(true);
    expect(isLooping(b)).toBe(false);
  });

  test("clearLoop drops both the intent and the repeat mode", () => {
    const queue = makeQueue();
    setLooping(queue, true);
    clearLoop(queue);
    expect(isLooping(queue)).toBe(false);
    expect(queue.repeatMode).toBe(QueueRepeatMode.OFF);
  });
});

describe("restoreLoop", () => {
  test("reapplies TRACK repeat after a skip cleared it", () => {
    const queue = makeQueue();
    setLooping(queue, true);
    queue.setRepeatMode(QueueRepeatMode.OFF);
    expect(restoreLoop(queue)).toBe(true);
    expect(queue.repeatMode).toBe(QueueRepeatMode.TRACK);
  });

  test("does nothing when the user never asked to loop", () => {
    const queue = makeQueue();
    expect(restoreLoop(queue)).toBe(false);
    expect(queue.repeatMode).toBe(QueueRepeatMode.OFF);
  });
});

describe("pause", () => {
  test("togglePause flips and reports the resulting state", async () => {
    const queue = makeQueue();
    expect(await togglePause(queue)).toBe(true);
    expect(await togglePause(queue)).toBe(false);
  });

  test("setPaused is explicit, so /pause twice stays paused", async () => {
    const queue = makeQueue();
    expect(await setPaused(queue, true)).toBe(true);
    expect(await setPaused(queue, true)).toBe(true);
  });
});

describe("skipTrack", () => {
  // The core interaction: skip() honours TRACK repeat, so leaving it on restarts the song rather than advancing.
  test("clears TRACK repeat before skipping so the queue advances", async () => {
    const queue = makeQueue();
    setLooping(queue, true);
    await skipTrack(queue);
    expect(queue.repeatMode).toBe(QueueRepeatMode.OFF);
    expect(queue.state.skipped).toBe(1);
  });

  test("keeps the loop intent so it carries to the next track", async () => {
    const queue = makeQueue();
    setLooping(queue, true);
    await skipTrack(queue);
    expect(isLooping(queue)).toBe(true);
    restoreLoop(queue);
    expect(queue.repeatMode).toBe(QueueRepeatMode.TRACK);
  });

  test("resumes first, because a paused queue cannot advance", async () => {
    const queue = makeQueue({ paused: true });
    await skipTrack(queue);
    expect(queue.state.paused).toBe(false);
    expect(queue.state.skipped).toBe(1);
  });
});

describe("stopPlayback", () => {
  // A stale loop surviving into the next /play would silently repeat one song.
  test("clears the loop so it does not leak into the next session", async () => {
    const queue = makeQueue();
    setLooping(queue, true);
    await stopPlayback(queue);
    expect(isLooping(queue)).toBe(false);
    expect(queue.repeatMode).toBe(QueueRepeatMode.OFF);
    expect(queue.state.stopped).toBe(1);
  });
});
