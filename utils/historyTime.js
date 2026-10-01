const DAY_MS = 86400000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

function parseBound(value) {
  if (value === undefined || value === null || value === "") return null;
  if (!ISO_DATE.test(value)) return NaN;
  // Date-only strings parse as UTC midnight; a bare date-time is pinned to UTC too, matching [Now].
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  return Date.parse(value.length > 10 && !hasZone ? `${value}Z` : value);
}

// `before` is exclusive, so after=2025-01-01 before=2026-01-01 is exactly the year 2025.
function parseRange({ after, before } = {}) {
  const afterMs = parseBound(after);
  const beforeMs = parseBound(before);
  if (Number.isNaN(afterMs) || Number.isNaN(beforeMs)) return { error: "after and before must be ISO dates like 2026-09-21." };
  if (afterMs === null && beforeMs === null) return null;
  if (afterMs !== null && beforeMs !== null && afterMs >= beforeMs) return { error: "after must be earlier than before." };
  return { afterMs, beforeMs };
}

function groupConversations(rows, gapMs) {
  const groups = [];
  for (const row of rows) {
    const current = groups[groups.length - 1];
    if (current && row.created_at - current[current.length - 1].created_at <= gapMs) current.push(row);
    else groups.push([row]);
  }
  return groups;
}

// Picks the largest conversations when there are too many, then restores time order so the digest reads chronologically.
function selectConversations(groups, max, order) {
  if (groups.length <= max) return groups;
  if (order === "oldest") return groups.slice(0, max);
  if (order === "newest") return groups.slice(-max);
  return [...groups]
    .map((g, i) => ({ g, i }))
    .sort((a, b) => b.g.length - a.g.length)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map(x => x.g);
}

function toVector(embedding) {
  if (!embedding) return null;
  if (embedding instanceof Float32Array) return embedding;
  if (Buffer.isBuffer(embedding)) {
    return new Float32Array(embedding.buffer.slice(embedding.byteOffset, embedding.byteOffset + embedding.byteLength));
  }
  return Array.isArray(embedding) ? Float32Array.from(embedding) : null;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

// The message nearest the conversation's mean vector is the one most like the rest of it, which is usually the topic.
function pickRepresentative(rows, count, selfId) {
  const others = rows.filter(r => r.author_id !== selfId);
  const pool = others.length > 0 ? others : rows;
  const vectors = pool.map(r => toVector(r.embedding));
  const withVec = pool.map((row, i) => ({ row, vec: vectors[i] })).filter(x => x.vec);

  let chosen;
  if (withVec.length >= Math.min(count, pool.length)) {
    const dims = withVec[0].vec.length;
    const mean = new Float32Array(dims);
    for (const { vec } of withVec) for (let i = 0; i < dims; i++) mean[i] += vec[i] / withVec.length;
    chosen = withVec
      .map(x => ({ row: x.row, score: cosine(mean, x.vec) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, count)
      .map(x => x.row);
  } else {
    chosen = [pool[0], ...[...pool.slice(1)].sort((a, b) => b.content.length - a.content.length)].slice(0, count);
  }
  return chosen.sort((a, b) => a.created_at - b.created_at);
}

// Gaps include the stretch before the first message and after the last, clipped to the range and to now.
function coverageGaps(timestamps, { afterMs, beforeMs }, { minGapMs = 14 * DAY_MS, now = Date.now() } = {}) {
  const end = Math.min(beforeMs ?? now, now);
  if (timestamps.length === 0) return afterMs !== null && afterMs < end ? [[afterMs, end]] : [];
  const points = [afterMs ?? timestamps[0], ...timestamps, end];
  const gaps = [];
  for (let i = 1; i < points.length; i++) {
    if (points[i] - points[i - 1] > minGapMs) gaps.push([points[i - 1], points[i]]);
  }
  return gaps;
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

module.exports = { DAY_MS, parseRange, groupConversations, selectConversations, pickRepresentative, coverageGaps, isoDate, toVector };
