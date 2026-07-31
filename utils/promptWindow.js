// History-window selection for the chatbot prompt.
//
// A window that keeps the newest N messages slides by one every turn, which
// moves the first history message and breaks DeepSeek's prefix cache right
// after the system prompt — on every single turn. Instead the oldest message is
// pinned as an anchor and the window grows by appending, re-anchoring only when
// it outgrows `max`. That turns a guaranteed per-turn miss into one miss every
// (max - min) turns.

// Discord snowflakes sort lexically by magnitude, so BigInt comparison is a
// valid "newer than" test without fetching timestamps.
function isAtOrAfter(id, floor) {
  try {
    return BigInt(id) >= BigInt(floor);
  } catch (_) {
    return false;
  }
}

function pickFloor(anchorId, resetPointId) {
  if (!anchorId) return resetPointId || null;
  if (!resetPointId) return anchorId;
  try {
    return BigInt(anchorId) >= BigInt(resetPointId) ? anchorId : resetPointId;
  } catch (_) {
    return resetPointId;
  }
}

// `ids` must be oldest-first. Returns the window to send plus the anchor to
// persist; `reanchored` marks the turns where the caller has to write it back.
function selectAnchoredWindow({ ids, anchorId, resetPointId, min, max }) {
  const all = Array.isArray(ids) ? ids : [];
  const floor = pickFloor(anchorId, resetPointId);
  let kept = floor ? all.filter(id => isAtOrAfter(id, floor)) : all.slice();

  // A deleted or purged anchor would otherwise pin the window to nothing.
  const anchorLost = Boolean(anchorId) && kept.length === 0 && all.length > 0;
  if (anchorLost) kept = all.slice();

  if (kept.length > max) {
    const trimmed = kept.slice(kept.length - min);
    return { ids: trimmed, nextAnchorId: trimmed[0], reanchored: true };
  }
  if (anchorLost) {
    return { ids: kept, nextAnchorId: kept[0] ?? null, reanchored: true };
  }
  return { ids: kept, nextAnchorId: anchorId || kept[0] || null, reanchored: false };
}

module.exports = { selectAnchoredWindow, pickFloor };
