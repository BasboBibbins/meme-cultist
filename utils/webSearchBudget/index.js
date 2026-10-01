const config = require("../../config.js");
const logger = require("../logger");
const store = require("./store");
const { dayKey, monthKey, endOfUtcDay, evaluateBudget, parseMonthlyWindow, providerExhausted, projectMonth } = require("./logic");

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
  const limitHeader = headers?.get?.("x-ratelimit-limit");
  const remainingHeader = headers?.get?.("x-ratelimit-remaining");
  logger.debug(`[WebSearchBudget] Brave HTTP ${status}, x-ratelimit-limit: ${limitHeader ?? "absent"}, x-ratelimit-remaining: ${remainingHeader ?? "absent"}`);
  const monthlyLimit = parseMonthlyWindow(limitHeader);
  const monthlyRemaining = parseMonthlyWindow(remainingHeader);
  store.setState("provider", monthlyLimit > 0 && monthlyRemaining !== null ? { month: monthKey(now), remaining: monthlyRemaining } : null);
  // Blocks for a day, not the month, so a topped-up credit is noticed by the next day's first try.
  if (providerExhausted({ status, monthlyLimit, monthlyRemaining })) {
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
