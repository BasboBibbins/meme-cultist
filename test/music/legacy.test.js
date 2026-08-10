// play-dl still backs the onBeforeCreateStream override in play.js; this records whether it works, so removing it is evidence-based.

const assert = require("assert");
const { testAsync, capability, results } = require("./harness");

const YT_URL = "https://www.youtube.com/watch?v=FGBhQbmPwH8";

async function run() {
  await testAsync("play-dl can validate a YouTube URL", async () => {
    let playdl;
    try {
      playdl = require("play-dl");
    } catch (_) {
      capability("legacy", "play-dl installed", "OK", "removed from the tree");
      return;
    }
    const type = await playdl.validate(YT_URL);
    capability("legacy", "play-dl validate", type ? "OK" : "FAIL", type ? String(type) : "rejected a valid YouTube URL");
    assert.ok(type, "play-dl no longer recognises YouTube URLs");
  });

  await testAsync("play-dl can open a stream", async () => {
    let playdl;
    try {
      playdl = require("play-dl");
    } catch (_) {
      capability("legacy", "play-dl stream", "OK", "removed from the tree");
      return;
    }
    try {
      const res = await playdl.stream(YT_URL);
      capability("legacy", "play-dl stream", res?.stream ? "OK" : "FAIL", res?.stream ? `type ${res.type}` : "returned no stream");
      assert.ok(res?.stream);
    } catch (err) {
      capability("legacy", "play-dl stream", "FAIL", `${err.message} — the play.js override cannot work`);
      throw err;
    }
  });

  return results();
}

module.exports = { run };
