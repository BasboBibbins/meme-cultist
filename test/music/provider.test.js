// The yt-dlp stream provider that replaced play-dl — the only path by which YouTube audio reaches a voice channel.

const assert = require("assert");
const fs = require("fs");
const { testAsync, capability, drain, results } = require("./harness");

const YT_URL = "https://www.youtube.com/watch?v=FGBhQbmPwH8";

async function run() {
  await testAsync("yt-dlp binary is present", async () => {
    const { YTDLP } = require("../../utils/musicStream");
    const exists = fs.existsSync(YTDLP);
    capability("provider", "yt-dlp binary", exists ? "OK" : "FAIL", exists ? YTDLP : `missing at ${YTDLP}`);
    assert.ok(exists, "yt-dlp binary not found");
  });

  await testAsync("the provider claims YouTube URLs and ignores others", async () => {
    const { shouldUseYtdlp } = require("../../utils/musicStream");
    assert.ok(shouldUseYtdlp("https://www.youtube.com/watch?v=abc"), "should claim youtube.com");
    assert.ok(shouldUseYtdlp("https://youtu.be/abc"), "should claim youtu.be");
    assert.ok(!shouldUseYtdlp("https://soundcloud.com/forss/flickermood"), "should not claim SoundCloud");
    capability("provider", "URL routing", "OK", "YouTube only; other providers keep their own extractor");
  });

  await testAsync("yt-dlp produces YouTube audio bytes", async () => {
    const { createYtdlpStream } = require("../../utils/musicStream");
    const bytes = await drain(createYtdlpStream(YT_URL), { minBytes: 200000, timeoutMs: 45000 });
    capability("provider", "YouTube audio via yt-dlp", bytes > 0 ? "OK" : "FAIL", bytes > 0 ? `${bytes} bytes received` : "no data — playback will be silent");
    assert.ok(bytes > 0, "yt-dlp produced no audio");
  });

  // Constraining the format to webm resolves a URL that then 403s on download — success-looking until nothing plays.
  await testAsync("the format selector is not over-constrained", async () => {
    const { FORMAT } = require("../../utils/musicStream");
    capability("provider", "Format selector", FORMAT === "bestaudio" ? "OK" : "WARN", FORMAT);
    assert.strictEqual(FORMAT, "bestaudio");
  });

  await testAsync("play-dl is gone from the dependency tree", async () => {
    let present = true;
    try { require.resolve("play-dl"); } catch (_) { present = false; }
    capability("provider", "play-dl removed", present ? "WARN" : "OK", present ? "still installed" : "removed");
    assert.ok(!present, "play-dl is still installed");
  });

  return results();
}

module.exports = { run };
