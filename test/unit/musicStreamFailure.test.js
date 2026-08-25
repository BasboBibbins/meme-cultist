// The failure path, which is the one that took the process down: discord-player's demuxable fast
// path only pipes the stream it is handed, so nothing downstream ever listens for an "error" event
// on it. A dead track therefore has to reject the hook rather than destroy the stream.

jest.mock("../../utils/logger", () => ({
  log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn(),
}));

jest.mock("child_process", () => ({ spawn: jest.fn(), spawnSync: jest.fn(() => ({ status: 0, stdout: "" })) }));

const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const { spawn } = require("child_process");
const { createYtdlpStream, UnplayableTrackError, takeUnplayableReason, ytdlpAttempts } = require("../../utils/music/stream");

// A yt-dlp stand-in. `audio` is what it writes to stdout before exiting with `code`.
function fakeYtdlp({ audio = null, code = 1 } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  process.nextTick(() => {
    child.stderr.write("ERROR: unable to download video data: HTTP Error 403: Forbidden");
    if (audio) child.stdout.write(audio);
    process.nextTick(() => { child.stdout.end(); child.emit("close", audio ? 0 : code); });
  });
  return child;
}

beforeEach(() => spawn.mockReset());

describe("createYtdlpStream", () => {
  test("rejects with UnplayableTrackError once every attempt returns no audio", async () => {
    spawn.mockImplementation(() => fakeYtdlp({ audio: null }));
    const track = { id: "dead", title: "Yeat - The Bell" };

    await expect(createYtdlpStream("https://youtube.com/watch?v=x", track)).rejects.toThrow(UnplayableTrackError);
    expect(spawn).toHaveBeenCalledTimes(ytdlpAttempts().length);
  });

  test("records the reason so the queue handler can report it verbatim", async () => {
    spawn.mockImplementation(() => fakeYtdlp({ audio: null }));
    const track = { id: "dead2", title: "Yeat - The Bell" };

    await createYtdlpStream("https://youtube.com/watch?v=x", track).catch(() => {});
    expect(takeUnplayableReason(track)).toContain("Yeat - The Bell");
  });

  // Rejecting is the whole point: an "error" event on the returned stream reaches no listener and
  // becomes an uncaught exception, which is what left a dead track stuck and unskippable.
  test("never emits an unhandled error on the returned stream", async () => {
    spawn.mockImplementation(() => fakeYtdlp({ audio: null }));
    const onUncaught = jest.fn();
    process.on("uncaughtException", onUncaught);

    await createYtdlpStream("https://youtube.com/watch?v=x", { id: "dead3", title: "t" }).catch(() => {});
    await new Promise(r => setTimeout(r, 50));

    process.off("uncaughtException", onUncaught);
    expect(onUncaught).not.toHaveBeenCalled();
  });

  test("resolves on the first chunk rather than waiting for the whole track", async () => {
    spawn.mockImplementation(() => fakeYtdlp({ audio: Buffer.from("OggS-ish audio") }));

    const { stream } = await createYtdlpStream("https://youtube.com/watch?v=ok", { id: "live", title: "t" });
    expect(typeof stream.pipe).toBe("function");
  });

  test("falls through to the next attempt before giving up", async () => {
    let call = 0;
    spawn.mockImplementation(() => fakeYtdlp(++call === 1 ? { audio: null } : { audio: Buffer.from("audio") }));

    await expect(createYtdlpStream("https://youtube.com/watch?v=ok", { id: "retry", title: "t" })).resolves.toBeDefined();
    expect(call).toBe(2);
  });
});

describe("ytdlpAttempts", () => {
  // The web clients are offered nothing but muxed 360p video whose audio is 44.1kHz AAC, so an
  // opus-pinned attempt has to come first or every track is transcoded from the worst source YouTube has.
  test("leads with an opus-pinned attempt so playback needs no transcode", () => {
    const [first] = ytdlpAttempts({ poToken: "PO", visitorData: "VD" });
    expect(first.opus).toBe(true);
    expect(first.args.join(" ")).toContain("acodec=opus");
  });

  test("puts ios first, the one client that needs no JS challenge solved", () => {
    expect(ytdlpAttempts({ poToken: "PO", visitorData: "VD" })[0].label).toBe("ios opus");
  });

  test("marks the generic attempts as needing a transcode", () => {
    const generic = ytdlpAttempts(null);
    expect(generic.every(a => a.opus !== true)).toBe(true);
  });

  test("keeps the tokenless strategies as fallbacks for a failed mint", () => {
    const labels = ytdlpAttempts({ poToken: "PO", visitorData: "VD" }).map(a => a.label);
    expect(labels).toEqual(expect.arrayContaining(["no cookies", "JS-free clients"]));
  });

  // The token is bound to its visitor data; sending one without the other is rejected.
  test("sends the token and its visitor data together", () => {
    const [first] = ytdlpAttempts({ poToken: "PO", visitorData: "VD" });
    const args = first.args.join(" ");
    expect(args).toContain("po_token=ios.gvs+PO");
    expect(args).toContain("visitor_data=VD");
  });

  test("omits the token attempt entirely when none could be minted", () => {
    expect(ytdlpAttempts(null).some(a => a.args.join(" ").includes("po_token"))).toBe(false);
  });
});
