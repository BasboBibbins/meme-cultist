const config = require("../../config.js");
const logger = require("../logger");
const store = require("./store");
const { dayKey, monthKey, endOfUtcDay, evaluateBudget, parseMonthlyRemaining, projectMonth } = require("./logic");

function evaluate(now) {
  const day = dayKey(now);
  const month = monthKey(now);
  const provider = store.getState("provider");
  const blockedUntil = store.getState("blockedUntil") || 0;
  const providerRemaining = provider?.month === month ? provider.remaining : null;
  const usage = { day, month, dayUsed: store.dayCount(day), monthUsed: store.monthCount(month), blockedUntil, providerRemaining };
  const decision = evaluateBudget({
    monthlyBudget: config.WEB_SEARCH_MONTHLY_BUDGET,
    monthUsed: usage.monthUsed,
    dayUsed: usage.dayUsed,
    now,
    pacingFactor: config.WEB_SEARCH_PACING_FACTOR,
    dailyFloor: config.WEB_SEARCH_DAILY_FLOOR,
    blockedUntil,
  });
  return { ...usage, ...decision };
}

// Synchronous from check to increment, so two concurrent searches cannot both take the last slot.
function reserveSearch(now = Date.now()) {
  const decision = evaluate(now);
  if (decision.allowed) store.adjustDay(decision.day, 1);
  else logger.log(`[WebSearchBudget] Search refused (${decision.reason}): ${decision.dayUsed}/${decision.dailyLimit} today, ${decision.monthUsed}/${config.WEB_SEARCH_MONTHLY_BUDGET} this month.`);
  return decision;
}

function releaseSearch(day) {
  store.adjustDay(day, -1);
}

function recordResponse(headers, status, now = Date.now()) {
  const header = headers?.get?.("x-ratelimit-remaining");
  logger.debug(`[WebSearchBudget] Brave HTTP ${status}, x-ratelimit-remaining: ${header ?? "absent"}`);
  const remaining = parseMonthlyRemaining(header);
  if (remaining !== null) store.setState("provider", { month: monthKey(now), remaining });
  // Blocks for a day, not the month, so a topped-up credit is noticed by the next day's first try.
  if (status === 402 || remaining === 0) {
    store.setState("blockedUntil", endOfUtcDay(now));
    logger.warn(`[WebSearchBudget] Brave reported no allowance left (HTTP ${status}). Web search is off until midnight UTC.`);
  }
}

function getSearchUsage(now = Date.now()) {
  const usage = evaluate(now);
  return {
    ...usage,
    monthlyBudget: config.WEB_SEARCH_MONTHLY_BUDGET,
    projected: projectMonth(usage.monthUsed, now),
    costPer1k: config.WEB_SEARCH_COST_PER_1K,
  };
}

module.exports = { reserveSearch, releaseSearch, recordResponse, getSearchUsage };
