const KENO_TOTAL_NUMBERS = 80;
const KENO_DRAW_COUNT = 20;
const KENO_MIN_SPOTS = 1;
const KENO_MAX_SPOTS = 10;

// "For 1" multipliers — payout replaces the stake. Every row's RTP is asserted
// in test/unit/keno.test.js; re-run it after changing any entry.
const PAYTABLE = Object.freeze({
  1:  Object.freeze([0, 3.8]),
  2:  Object.freeze([0, 1, 9.5]),
  3:  Object.freeze([0, 0, 1, 58.5]),
  4:  Object.freeze([0, 0, 1.5, 6, 120]),
  5:  Object.freeze([0, 0, 0, 2.2, 20, 800]),
  6:  Object.freeze([0, 0, 0, 1.5, 11, 77, 1600]),
  7:  Object.freeze([0, 0, 0, 1.5, 4.5, 30, 145, 4000]),
  8:  Object.freeze([0, 0, 0, 0, 3.4, 17, 85, 850, 6000]),
  9:  Object.freeze([0, 0, 0, 0, 1.6, 8, 39, 310, 3100, 8000]),
  10: Object.freeze([0, 0, 0, 0, 1.4, 2.8, 21, 140, 700, 5600, 10000]),
});

// C(80, 20) exceeds MAX_SAFE_INTEGER, so factors are folded in one at a time.
function combinations(n, k) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i++) result = result * (n - i) / (i + 1);
  return result;
}

function matchProbability(spots, matches) {
  return (
    combinations(spots, matches) *
    combinations(KENO_TOTAL_NUMBERS - spots, KENO_DRAW_COUNT - matches) /
    combinations(KENO_TOTAL_NUMBERS, KENO_DRAW_COUNT)
  );
}

function getMultiplier(spots, matches) {
  const row = PAYTABLE[spots];
  if (!row) return 0;
  return row[matches] ?? 0;
}

function expectedReturn(spots) {
  const row = PAYTABLE[spots];
  if (!row) return 0;
  let total = 0;
  for (let matches = 0; matches <= spots; matches++) {
    total += matchProbability(spots, matches) * row[matches];
  }
  return total;
}

function parseSpots(input) {
  if (typeof input !== "string" || input.trim().length === 0) {
    return { error: `Enter between ${KENO_MIN_SPOTS} and ${KENO_MAX_SPOTS} numbers, separated by commas or spaces.` };
  }

  const tokens = input.trim().split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) {
    return { error: `Enter between ${KENO_MIN_SPOTS} and ${KENO_MAX_SPOTS} numbers, separated by commas or spaces.` };
  }
  if (tokens.length > KENO_MAX_SPOTS) {
    return { error: `You can pick at most ${KENO_MAX_SPOTS} numbers — you entered ${tokens.length}.` };
  }

  const spots = [];
  const seen = new Set();
  for (const token of tokens) {
    if (!/^\d+$/.test(token)) {
      return { error: `\`${token}\` isn't a whole number. Pick numbers between 1 and ${KENO_TOTAL_NUMBERS}.` };
    }
    const value = parseInt(token, 10);
    if (value < 1 || value > KENO_TOTAL_NUMBERS) {
      return { error: `\`${value}\` is out of range. Pick numbers between 1 and ${KENO_TOTAL_NUMBERS}.` };
    }
    if (seen.has(value)) {
      return { error: `You picked \`${value}\` more than once. Every number must be different.` };
    }
    seen.add(value);
    spots.push(value);
  }

  return { spots: spots.sort((a, b) => a - b) };
}

function drawDistinct(count, rng) {
  const pool = [];
  for (let i = 1; i <= KENO_TOTAL_NUMBERS; i++) pool.push(i);
  const picked = [];
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    picked.push(pool[i]);
  }
  return picked.sort((a, b) => a - b);
}

function quickPick(count, rng = Math.random) {
  const safeCount = Math.min(Math.max(Math.trunc(count) || 0, KENO_MIN_SPOTS), KENO_MAX_SPOTS);
  return drawDistinct(safeCount, rng);
}

function drawNumbers(rng = Math.random) {
  return drawDistinct(KENO_DRAW_COUNT, rng);
}

function countMatches(spots, drawn) {
  const drawnSet = new Set(drawn);
  return spots.filter(n => drawnSet.has(n)).length;
}

function resolveKeno({ spots, bet, rng = Math.random }) {
  const drawn = drawNumbers(rng);
  const drawnSet = new Set(drawn);
  const matched = spots.filter(n => drawnSet.has(n));
  const matches = matched.length;
  const multiplier = getMultiplier(spots.length, matches);
  const payout = Math.floor(bet * multiplier);
  const net = payout - bet;

  return {
    drawn,
    matched,
    matches,
    multiplier,
    payout,
    net,
    outcome: net > 0 ? "win" : net < 0 ? "loss" : "push",
  };
}

module.exports = {
  KENO_TOTAL_NUMBERS,
  KENO_DRAW_COUNT,
  KENO_MIN_SPOTS,
  KENO_MAX_SPOTS,
  PAYTABLE,
  parseSpots,
  quickPick,
  drawNumbers,
  countMatches,
  getMultiplier,
  matchProbability,
  expectedReturn,
  resolveKeno,
};
