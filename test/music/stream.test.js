// A separate failure domain from search: search can succeed while every track still fails to produce audio.

const assert = require("assert");
const { QueryType } = require("discord-player");
const { testAsync, capability, getPlayer, drain, isStreamUrl, results } = require("./harness");

async function streamFirstResult(area, name, query) {
  const player = await getPlayer();
  const res = await player.search(query, { searchEngine: QueryType.AUTO });
  if (!res?.tracks?.length) {
    capability(area, name, "SKIP", "no search results to stream");
    return { skipped: true };
  }
  const track = res.tracks[0];
  try {
    const stream = await track.extractor.stream(track);
    if (!stream) {
      capability(area, name, "FAIL", "extractor.stream() returned nothing");
      return { bytes: 0 };
    }
    if (isStreamUrl(stream)) {
      const host = new URL(stream).host;
      capability(area, name, "OK", `resolved to a stream URL (${host})`);
      return { bytes: 1, url: stream };
    }
    const bytes = await drain(stream);
    capability(area, name, bytes > 0 ? "OK" : "FAIL", bytes > 0 ? `${bytes} bytes received` : "stream produced no data");
    return { bytes };
  } catch (err) {
    capability(area, name, "FAIL", err.message);
    throw err;
  }
}

async function run() {
  await testAsync("YouTube track produces an audio stream", async () => {
    const { bytes, skipped } = await streamFirstResult("stream", "YouTube", "daft punk one more time");
    if (skipped) return;
    assert.ok(bytes > 0, "no audio bytes received");
  });

  await testAsync("SoundCloud track produces an audio stream", async () => {
    const { bytes, skipped } = await streamFirstResult("stream", "SoundCloud", "https://soundcloud.com/forss/flickermood");
    if (skipped) return;
    assert.ok(bytes > 0, "no audio bytes received");
  });

  // The bridge is where a Spotify link becomes playable audio; metadata resolving does not prove this half works.
  await testAsync("Spotify track bridges to playable audio", async () => {
    const { bytes, skipped } = await streamFirstResult("stream", "Spotify (bridged)", "https://open.spotify.com/track/0DiWol3AO6WpXZgp0goxAV");
    if (skipped) return;
    assert.ok(bytes > 0, "no audio bytes received");
  });

  return results();
}

module.exports = { run };
