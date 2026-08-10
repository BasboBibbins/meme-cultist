// Per-provider search coverage: a zero-result search is how every broken-extractor failure presents.

const assert = require("assert");
const { QueryType } = require("discord-player");
const { testAsync, capability, getPlayer, results } = require("./harness");

const TEXT_QUERY = "daft punk one more time";
const YT_URL = "https://www.youtube.com/watch?v=FGBhQbmPwH8";
const YT_PLAYLIST = "https://www.youtube.com/playlist?list=PLQOaFYSPeMBrp3ZNKMHhTsRIfDCzYvOgV";
const SC_URL = "https://soundcloud.com/forss/flickermood";
const SC_SET = "https://soundcloud.com/forss/sets/soulhack";
const SP_URL = "https://open.spotify.com/track/0DiWol3AO6WpXZgp0goxAV";

async function probe(area, name, query, engine = QueryType.AUTO) {
  const player = await getPlayer();
  const res = await player.search(query, { searchEngine: engine });
  const count = res?.tracks?.length ?? 0;
  capability(area, name, count > 0 ? "OK" : "FAIL", count > 0 ? `${count} result(s) — "${res.tracks[0].title}"` : "0 results");
  return res;
}

async function run() {
  await testAsync("YouTube text search returns tracks", async () => {
    const res = await probe("search", "YouTube (text)", TEXT_QUERY);
    assert.ok(res.tracks.length > 0, "no tracks returned");
  });

  await testAsync("YouTube text search returns usable metadata", async () => {
    const player = await getPlayer();
    const res = await player.search(TEXT_QUERY, { searchEngine: QueryType.AUTO });
    assert.ok(res.tracks.length, "no tracks to inspect");
    const t = res.tracks[0];
    const missing = ["title", "url", "author", "duration"].filter(k => !t[k]);
    capability("search", "Track metadata", missing.length ? "WARN" : "OK", missing.length ? `missing: ${missing.join(", ")}` : "title/url/author/duration present");
    assert.strictEqual(missing.length, 0, `missing fields: ${missing.join(", ")}`);
  });

  await testAsync("YouTube direct URL resolves", async () => {
    const res = await probe("search", "YouTube (URL)", YT_URL);
    assert.ok(res.tracks.length > 0);
  });

  await testAsync("YouTube playlist resolves to multiple tracks", async () => {
    const player = await getPlayer();
    const res = await player.search(YT_PLAYLIST, { searchEngine: QueryType.AUTO });
    const n = res?.tracks?.length ?? 0;
    capability("search", "YouTube (playlist)", n > 1 ? "OK" : "FAIL", n > 1 ? `${n} tracks` : `${n} track(s) — playlist not expanded`);
    assert.ok(n > 1, "playlist did not expand");
  });

  await testAsync("SoundCloud URL resolves", async () => {
    const res = await probe("search", "SoundCloud (URL)", SC_URL);
    assert.ok(res.tracks.length > 0);
  });

  await testAsync("SoundCloud set expands to multiple tracks", async () => {
    const player = await getPlayer();
    const res = await player.search(SC_SET, { searchEngine: QueryType.AUTO });
    const n = res?.tracks?.length ?? 0;
    capability("search", "SoundCloud (set)", n > 1 ? "OK" : "FAIL", n > 1 ? `${n} tracks — "${res.playlist?.title}"` : `${n} track(s) — set not expanded`);
    assert.ok(n > 1, "set did not expand");
  });

  await testAsync("SoundCloud text search returns tracks", async () => {
    const res = await probe("search", "SoundCloud (text)", "kygo firestone", QueryType.SOUNDCLOUD_SEARCH);
    assert.ok(res.tracks.length > 0);
  });

  // Spotify has no audio of its own; discord-player resolves metadata and bridges at play time, so this only proves lookup.
  await testAsync("Spotify URL resolves via the metadata bridge", async () => {
    const res = await probe("search", "Spotify (URL, bridged)", SP_URL);
    assert.ok(res.tracks.length > 0);
  });

  await testAsync("a nonsense query returns zero results without throwing", async () => {
    const player = await getPlayer();
    const res = await player.search("zzzqqxx no such track anywhere 4f7a2", { searchEngine: QueryType.AUTO });
    assert.ok(Array.isArray(res?.tracks), "search did not return a track array");
  });

  return results();
}

module.exports = { run };
