// Runs first: every music failure so far has been a version or missing package rather than bot logic.

const assert = require("assert");
const { test, testAsync, capability, results } = require("./harness");

// Read from disk rather than require("pkg/package.json") — an "exports" map can block that subpath.
function versionOf(pkg) {
  const fs = require("fs");
  const path = require("path");
  const file = path.join(process.cwd(), "node_modules", ...pkg.split("/"), "package.json");
  return JSON.parse(fs.readFileSync(file, "utf8")).version;
}

function major(v) {
  return parseInt(String(v).split(".")[0], 10);
}

async function run() {
  test("discord-player is v7", () => {
    const v = versionOf("discord-player");
    capability("environment", "discord-player", "OK", v);
    assert.strictEqual(major(v), 7, `expected 7.x, got ${v}`);
  });

  test("youtubei.js is recent enough to parse YouTube's player", () => {
    const v = versionOf("youtubei.js");
    // 14.x cannot extract the signature cipher and returns zero results with no error.
    const ok = major(v) >= 16;
    capability("environment", "youtubei.js", ok ? "OK" : "FAIL", `${v}${ok ? "" : " — too old, search returns 0 results"}`);
    assert.ok(ok, `youtubei.js ${v} is too old; needs >= 16`);
  });

  test("discord-player-youtubei is installed", () => {
    const v = versionOf("discord-player-youtubei");
    capability("environment", "discord-player-youtubei", "OK", v);
    assert.ok(v);
  });

  test("@snazzah/davey is present for DAVE voice encryption", () => {
    let v = null;
    try { v = versionOf("@snazzah/davey"); } catch (_) { /* absent */ }
    // discord-voip calls getMaxProtocolVersion() on every voice websocket open and throws without this.
    capability("environment", "@snazzah/davey", v ? "OK" : "FAIL", v || "missing — voice connections throw on connect");
    assert.ok(v, "@snazzah/davey is not installed; voice connections will throw");
  });

  await testAsync("davey exposes DAVE_PROTOCOL_VERSION", async () => {
    const davey = require("@snazzah/davey");
    assert.ok(davey.DAVE_PROTOCOL_VERSION >= 1);
  });

  test("an ffmpeg binary is resolvable", () => {
    let src = null;
    try {
      const p = require("ffmpeg-static");
      if (p) src = `ffmpeg-static: ${p}`;
    } catch (_) { /* fall through to PATH */ }
    if (!src) {
      const { spawnSync } = require("child_process");
      const probe = spawnSync("ffmpeg", ["-version"]);
      if (!probe.error) src = "system PATH";
    }
    capability("environment", "ffmpeg", src ? "OK" : "FAIL", src || "not found — transcoding will fail");
    assert.ok(src, "no ffmpeg binary found via ffmpeg-static or PATH");
  });

  return results();
}

module.exports = { run };
