const { DAILY_MIN, DAILY_MAX, DAILY_STREAK_BONUS_MIN_PER_DAY, DAILY_STREAK_BONUS_MAX_PER_DAY, WEEKLY_MIN, WEEKLY_MAX } = require("../config.js");

function rollRange(min, max, rng = Math.random) {
  return min + Math.floor(rng() * (max - min + 1));
}

function rollDaily(streak, rng = Math.random) {
  const amount = rollRange(DAILY_MIN, DAILY_MAX, rng);
  const bonus = streak > 1 ? rollRange(streak * DAILY_STREAK_BONUS_MIN_PER_DAY, streak * DAILY_STREAK_BONUS_MAX_PER_DAY, rng) : 0;
  return { amount, bonus };
}

function rollWeekly(rng = Math.random) {
  return rollRange(WEEKLY_MIN, WEEKLY_MAX, rng);
}

module.exports = { rollRange, rollDaily, rollWeekly };
