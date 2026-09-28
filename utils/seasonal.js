const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function normalizeAvailability(availability) {
  if (!availability) return [];
  const ranges = Array.isArray(availability) ? availability : [availability];
  return ranges.filter(r => r && r.start && r.end);
}

function resolveRange(range, date) {
  const { start, end } = range;
  const y = date.getUTCFullYear();

  const startYear = start.year ?? y;
  const endYear = end.year ?? (start.year ? end.year ?? start.year : y);

  const startMonth = start.month;
  const startDay = start.day ?? 1;
  const endMonth = end.month;
  const endDay = end.day ?? new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();

  return {
    startMs: Date.UTC(startYear, startMonth - 1, startDay),
    endMs:   Date.UTC(endYear, endMonth - 1, endDay, 23, 59, 59, 999),
    endYear,
    endMonth,
    endDay,
    endYearPinned: end.year != null,
  };
}

function todayMs(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function isRangeActive(resolved, nowMs) {
  // Year-wrap: e.g. Dec 20 → Jan 5
  if (resolved.startMs > resolved.endMs) {
    return nowMs >= resolved.startMs || nowMs <= resolved.endMs;
  }
  return nowMs >= resolved.startMs && nowMs <= resolved.endMs;
}

function isWindowActive(availability, date = new Date()) {
  const nowMs = todayMs(date);
  return normalizeAvailability(availability)
    .some(range => isRangeActive(resolveRange(range, date), nowMs));
}

// With overlapping ranges the latest close wins, so the deadline never understates the window.
function windowEndEpoch(availability, date = new Date()) {
  const nowMs = todayMs(date);
  let latest = null;

  for (const range of normalizeAvailability(availability)) {
    const r = resolveRange(range, date);
    if (!isRangeActive(r, nowMs)) continue;

    let endMs = r.endMs;
    // In the December head of a recurring wrap, the window closes next January.
    if (r.startMs > r.endMs && !r.endYearPinned && nowMs >= r.startMs) {
      endMs = Date.UTC(r.endYear + 1, r.endMonth - 1, r.endDay, 23, 59, 59, 999);
    }
    if (latest === null || endMs > latest) latest = endMs;
  }

  return latest === null ? null : Math.floor(latest / 1000);
}

// One recurring range is enough to bring a window back.
function isOneTimeAvailability(availability) {
  const ranges = normalizeAvailability(availability);
  if (!ranges.length) return false;
  return ranges.every(r => r.start.year != null || r.end.year != null);
}

function formatRange(range) {
  const { start, end } = range;

  const fmtStart = start.day
    ? `${MONTHS[start.month - 1]} ${start.day}`
    : MONTHS[start.month - 1];
  const fmtEnd = end.day
    ? `${MONTHS[end.month - 1]} ${end.day}`
    : MONTHS[end.month - 1];

  let str = fmtStart === fmtEnd ? fmtStart : `${fmtStart} - ${fmtEnd}`;

  const yr = end.year ?? start.year;
  if (yr != null) str += `, ${yr}`;

  return str;
}

function formatAvailability(availability) {
  const ranges = normalizeAvailability(availability);
  if (!ranges.length) return "";

  const sorted = ranges.slice().sort((a, b) =>
    (a.start.month - b.start.month) || ((a.start.day ?? 1) - (b.start.day ?? 1))
  );

  let str = sorted.map(formatRange).join(", ");

  const anyYear = ranges.some(r => r.start.year != null || r.end.year != null);
  if (!anyYear) str += " (yearly)";

  return str;
}

module.exports = {
  normalizeAvailability,
  isWindowActive,
  windowEndEpoch,
  isOneTimeAvailability,
  formatAvailability,
};
