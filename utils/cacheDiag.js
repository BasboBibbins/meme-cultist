// Diagnostic for DeepSeek's prefix cache. The billing API only reports how
// many tokens missed, never where the prefix diverged — so this tracks the
// previous turn's payload per channel and reports the first point of change,
// which is what tells you whether a miss came from the system prompt, the
// history boundary, or the turn context.

const logger = require("./logger");

const _lastTurn = new Map();

function commonPrefixLength(a, b) {
  if (!a || !b) return 0;
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

function diffTurn(previous, current) {
  if (!previous) return { firstDiverge: "cold", sysStable: 0, sysLength: current.sys.length, historyHeadChanged: false };
  const sysStable = commonPrefixLength(previous.sys, current.sys);
  const historyHeadChanged = previous.historyHead !== current.historyHead;
  let firstDiverge;
  if (sysStable < current.sys.length || sysStable < previous.sys.length) firstDiverge = "system";
  else if (historyHeadChanged) firstDiverge = "historyHead";
  else firstDiverge = "turnContext";
  return { firstDiverge, sysStable, sysLength: current.sys.length, historyHeadChanged };
}

function recordTurn(channelId, sys, historyHead) {
  const current = { sys: sys || "", historyHead: historyHead || "" };
  const result = diffTurn(_lastTurn.get(channelId), current);
  _lastTurn.set(channelId, current);
  logger.debug(
    `[cache] channel=${channelId} sysStable=${result.sysStable}/${result.sysLength} chars ` +
    `historyHead=${result.historyHeadChanged ? "changed" : "same"} firstDiverge=${result.firstDiverge}`
  );
  return result;
}

function forgetChannel(channelId) {
  _lastTurn.delete(channelId);
}

module.exports = { commonPrefixLength, diffTurn, recordTurn, forgetChannel };
