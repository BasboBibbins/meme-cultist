// A separate failure domain from search: search can succeed while every track still fails to produce audio.

const assert = require("assert");
const { QueryType } = require("discord-player");
const { WebmDemuxer, OggDemuxer, OpusDecoder } = require("@discord-player/opus");
const { StreamType } = require("discord-player");
const { testAsync, capability, getPlayer, drain, isStreamUrl, results } = require("./harness");

// Reproduces discord-player's demuxable fast path for a tagged {$fmt, stream}.
function toPcm(extracted) {
  if (!extracted || typeof extracted !== "object" || !extracted.$fmt) return extracted;
  const decoder = () => new OpusDecoder({ channels: 2, frameSize: 960, rate: 48000 });
  if (extracted.$fmt === StreamType.WebmOpus) return extracted.stream.pipe(new WebmDemuxer()).pipe(decoder());
  if (extracted.$fmt === StreamType.OggOpus) return extracted.stream.pipe(new OggDemuxer()).pipe(decoder());
  return extracted.stream;
}

async function streamFirstResult(area, name, query, engine = QueryType.AUTO) {
  const player = await getPlayer();
  const res = await player.search(query, { searchEngine: engine });
  if (!res?.tracks?.length) {
    capability(area, name, "SKIP", "no search results to stream");
    return { skipped: true };
  }
  const track = res.tracks[0];
  try {
    // Mirror production exactly: yt-dlp for YouTube, extractor otherwise, then the
    // remux hook. A URL that merely resolves is not proof of playable audio — that
    // assumption hid the -ss bug that made SoundCloud and Spotify play silence.
    const { beforeCreateStream, afterStreamExtracted } = require("../../utils/musicStream");
    const raw = (await beforeCreateStream(track)) || await track.extractor.stream(track);
    if (!raw) {
      capability(area, name, "FAIL", "extractor.stream() returned nothing");
      return { bytes: 0 };
    }
    const wasUrl = isStreamUrl(raw);
    // The DRM bridge reaches the player through the queue, exactly as in production.
    const extracted = await afterStreamExtracted(raw, track, { player });
    if (isStreamUrl(extracted)) {
      capability(area, name, "FAIL", "still a URL after the remux hook");
      return { bytes: 0 };
    }
    // Decode the way discord-player will: a webm stream that never demuxes still looks healthy on the wire, which is how a track reached "playing" then ended after 220ms.
    const stream = toPcm(extracted);
    const bytes = await drain(stream, { minBytes: 200000, timeoutMs: 45000 });
    const fmt = extracted && typeof extracted === "object" ? extracted.$fmt : null;
    const shape = wasUrl ? ` (remuxed from URL as ${fmt === StreamType.Raw ? "raw PCM, no re-encode" : fmt})` : "";
    capability(area, name, bytes > 0 ? "OK" : "FAIL", bytes > 0 ? `${bytes} PCM bytes${shape}` : "decoded to no audio");
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

  // Major-label SoundCloud audio is FairPlay-encrypted and decodes as noise; the earlier fixtures were all Creative Commons, so nothing here caught it.
  await testAsync("a DRM-protected source still yields audio via the YouTube bridge", async () => {
    const player = await getPlayer();
    const res = await player.search("Metro Boomin Space Cadet Gunna", { searchEngine: QueryType.SOUNDCLOUD_SEARCH });
    if (!res?.tracks?.length) {
      capability("stream", "DRM source (bridged)", "SKIP", "no SoundCloud result to test against");
      return;
    }
    const track = res.tracks[0];
    const raw = await track.extractor.stream(track);
    const { isDrmProtected } = require("../../utils/musicStream");
    if (typeof raw !== "string" || !isDrmProtected(raw)) {
      capability("stream", "DRM source (bridged)", "SKIP", "source is no longer DRM-protected");
      return;
    }
    const { bytes } = await streamFirstResult("stream", "DRM source (bridged)", "Metro Boomin Space Cadet Gunna", QueryType.SOUNDCLOUD_SEARCH);
    assert.ok(bytes > 0, "DRM-protected track produced no audio");
  });

  return results();
}

module.exports = { run };
