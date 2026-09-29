function dayKey(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function monthKey(now) {
  return new Date(now).toISOString().slice(0, 7);
}

function daysInMonth(now) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

function daysLeftInMonth(now) {
  return daysInMonth(now) - new Date(now).getUTCDate() + 1;
}

function endOfUtcDay(now) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

// Measured from the start of today, so spending today never shrinks today's own allowance.
function dailyLimit({ monthlyBudget, monthUsed, dayUsed, now, pacingFactor, dailyFloor }) {
  const remainingAtDayStart = Math.max(0, monthlyBudget - (monthUsed - dayUsed));
  return Math.max(dailyFloor, Math.floor((pacingFactor * remainingAtDayStart) / daysLeftInMonth(now)));
}

function evaluateBudget({ monthlyBudget, monthUsed, dayUsed, now, pacingFactor, dailyFloor, blockedUntil = 0 }) {
  const limit = dailyLimit({ monthlyBudget, monthUsed, dayUsed, now, pacingFactor, dailyFloor });
  const base = { dailyLimit: limit, monthRemaining: Math.max(0, monthlyBudget - monthUsed) };
  if (blockedUntil > now) return { ...base, allowed: false, reason: "provider" };
  if (monthUsed >= monthlyBudget) return { ...base, allowed: false, reason: "monthly" };
  if (dayUsed >= limit) return { ...base, allowed: false, reason: "daily" };
  return { ...base, allowed: true, reason: null };
}

// Brave sends "per-second, per-month" pairs; the last value is the monthly window.
function parseMonthlyRemaining(header) {
  if (!header) return null;
  const values = String(header).split(",").map(v => Number(v.trim()));
  if (values.length < 2) return null;
  const monthly = values[values.length - 1];
  return Number.isFinite(monthly) ? monthly : null;
}

function projectMonth(monthUsed, now) {
  const elapsed = new Date(now).getUTCDate();
  return Math.round((monthUsed / elapsed) * daysInMonth(now));
}

module.exports = { dayKey, monthKey, daysInMonth, daysLeftInMonth, endOfUtcDay, dailyLimit, evaluateBudget, parseMonthlyRemaining, projectMonth };
