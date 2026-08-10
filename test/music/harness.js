// Shared setup for the music suites. These hit real network endpoints, so they live outside Jest and never run in CI.

const { Client, GatewayIntentBits } = require("discord.js");
const { Player } = require("discord-player");

let passed = 0;
let failed = 0;
const capabilities = [];

// The diagnostic output: what a feature can actually do, which a pass/fail count alone does not say.
function capability(area, name, status, detail = "") {
  capabilities.push({ area, name, status, detail });
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL: ${name} — ${err.message}`);
  }
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL: ${name} — ${err.message}`);
  }
}

let _player = null;

// Registering extractors costs a network round trip, so every suite shares one player.
async function getPlayer() {
  if (_player) return _player;
  const { YoutubeiExtractor } = require("discord-player-youtubei");
  const { DefaultExtractors } = require("@discord-player/extractor");

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  const player = new Player(client);

  try {
    await player.extractors.loadMulti(DefaultExtractors);
  } catch (err) {
    capability("extractors", "DefaultExtractors", "FAIL", err.message);
  }
  try {
    await player.extractors.register(YoutubeiExtractor, {});
  } catch (err) {
    capability("extractors", "YoutubeiExtractor", "FAIL", err.message);
  }

  _player = player;
  return player;
}

// extractor.stream() may return a Node stream or a URL string for discord-player to fetch; both are success.
function isStreamUrl(value) {
  return typeof value === "string" && /^https?:\/\//.test(value);
}

// Pulls from a stream until it has enough bytes to prove audio is really flowing.
function drain(stream, { minBytes = 100000, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const timer = setTimeout(() => { try { stream.destroy(); } catch (_) {} resolve(bytes); }, timeoutMs);
    stream.on("data", chunk => {
      bytes += chunk.length;
      if (bytes >= minBytes) {
        clearTimeout(timer);
        try { stream.destroy(); } catch (_) {}
        resolve(bytes);
      }
    });
    stream.on("error", err => { clearTimeout(timer); reject(err); });
    stream.on("end", () => { clearTimeout(timer); resolve(bytes); });
  });
}

function results() {
  return { passed, failed };
}

module.exports = { test, testAsync, capability, capabilities, getPlayer, drain, isStreamUrl, results };
