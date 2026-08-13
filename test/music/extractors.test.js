// Extractor registration fails silently and surfaces much later as "no results found".

const assert = require("assert");
const { testAsync, capability, getPlayer, results } = require("./harness");

const EXPECTED = [
  ["YouTube", "youtubei"],
  ["SoundCloud", "soundcloud"],
  ["Spotify", "spotify"],
  ["Apple Music", "applemusic"],
  ["Vimeo", "vimeo"],
  ["Attachment", "attachment"],
];

async function run() {
  await testAsync("at least one extractor is registered", async () => {
    const player = await getPlayer();
    const ids = player.extractors.store.map(e => e.identifier);
    capability("extractors", "Total registered", ids.length ? "OK" : "FAIL", String(ids.length));
    assert.ok(ids.length > 0, "no extractors registered at all");
  });

  for (const [label, needle] of EXPECTED) {
    await testAsync(`${label} extractor is registered`, async () => {
      const player = await getPlayer();
      const ids = player.extractors.store.map(e => e.identifier);
      const found = ids.find(id => id.toLowerCase().includes(needle));
      capability("extractors", label, found ? "OK" : "FAIL", found || "not registered");
      assert.ok(found, `${label} extractor missing`);
    });
  }

  return results();
}

module.exports = { run };
