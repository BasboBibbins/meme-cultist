// Voice frames go out on a 20 ms schedule that advances whether or not the loop was
// free to send them (discord-voip's audioCycleStep clamps a late timer to 1 ms), so a
// stalled loop makes the player fire frames back-to-back to catch up. That is audible
// as tempo wobble and as jitter-buffer artifacts at the listener, which is why p99
// above one frame is the number that matters rather than the mean.
//
// Read the absolute numbers with the host in mind: Windows has a ~15.6 ms timer floor,
// so an idle process already reports a p50 near 15 ms and the frame budget has almost
// no headroom. Linux resolves close to 1 ms. Compare idle against playing on the same
// host rather than comparing hosts.

const { monitorEventLoopDelay } = require("perf_hooks");
const logger = require("./logger");

const FRAME_MS = 20;
const REPORT_INTERVAL_MS = 10000;

let histogram = null;
let timer = null;

function toMs(nanoseconds) {
  if (!Number.isFinite(nanoseconds)) return 0;
  return Math.round(nanoseconds / 1e5) / 10;
}

function report(isAudioActive) {
  const p99 = toMs(histogram.percentile(99));
  const active = isAudioActive();
  const line = `[LoopLag] mean ${toMs(histogram.mean)}ms p50 ${toMs(histogram.percentile(50))}ms `
    + `p99 ${p99}ms max ${toMs(histogram.max)}ms${active ? " — audio playing" : ""}`;

  // Only worth a warning while audio is actually flowing; an idle bot stalling hurts nobody.
  if (active && p99 > FRAME_MS) logger.warn(`${line} (over the ${FRAME_MS}ms frame budget)`);
  else logger.debug(line);

  histogram.reset();
}

function start(isAudioActive = () => false) {
  if (histogram) return;
  histogram = monitorEventLoopDelay({ resolution: 1 });
  histogram.enable();

  timer = setInterval(() => report(isAudioActive), REPORT_INTERVAL_MS);
  // Never hold the process open for a diagnostic.
  timer.unref();

  logger.debug(`[LoopLag] Sampling event loop delay every ${REPORT_INTERVAL_MS / 1000}s.`);
}

function stop() {
  if (timer) clearInterval(timer);
  if (histogram) histogram.disable();
  timer = null;
  histogram = null;
}

module.exports = { start, stop, FRAME_MS, REPORT_INTERVAL_MS };
