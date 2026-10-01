const {
  TRICK_OR_TREAT_MIN, TRICK_OR_TREAT_MAX, TRICK_OR_TREAT_WEALTH_BONUS_MAX, TRICK_OR_TREAT_WEALTH_CAP,
  TRICK_OR_TREAT_TRICK_CHANCE, TRICK_OR_TREAT_THEFT_RATE, HALLOWEEN_FORCE_ACTIVE, TRICK_OR_TREAT_FORCE_OUTCOME,
} = require("../config.js");
const { HALLOWEEN_WINDOW, isWindowActive, windowStartEpoch } = require("./seasonal");

const TRICKS = [
  { id: "noTreat", tier: "mild", weight: 40 },
  { id: "theft", tier: "mild", weight: 30 },
  { id: "possessed", tier: "medium", weight: 10 },
  { id: "impersonation", tier: "medium", weight: 10 },
  { id: "spooked", tier: "severe", weight: 5 },
  { id: "timeout", tier: "severe", weight: 5 },
];

function isEventActive(date = new Date()) {
  return HALLOWEEN_FORCE_ACTIVE || isWindowActive(HALLOWEEN_WINDOW, date);
}

function nextOpeningEpoch(date = new Date()) {
  return windowStartEpoch(HALLOWEEN_WINDOW, date);
}

function nextUtcMidnightMs(date = new Date()) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

function canClaim(nextClaimAt, now = Date.now(), forceActive = HALLOWEEN_FORCE_ACTIVE) {
  return forceActive || !(nextClaimAt > now);
}

function wealthBonus(wealth) {
  const clamped = Math.min(Math.max(Number(wealth) || 0, 0), TRICK_OR_TREAT_WEALTH_CAP);
  const fade = Math.log10(1 + clamped) / Math.log10(1 + TRICK_OR_TREAT_WEALTH_CAP);
  return Math.round(TRICK_OR_TREAT_WEALTH_BONUS_MAX * (1 - fade));
}

function rollTreat(wealth, rng = Math.random) {
  const base = TRICK_OR_TREAT_MIN + Math.floor(rng() * (TRICK_OR_TREAT_MAX - TRICK_OR_TREAT_MIN + 1));
  const bonus = wealthBonus(wealth);
  return { base, bonus, amount: base + bonus };
}

function forcedTrick(forced) {
  return TRICKS.find(t => t.id === forced) ?? null;
}

function isTrick(rng = Math.random, forced = TRICK_OR_TREAT_FORCE_OUTCOME) {
  if (forced === "treat") return false;
  if (forcedTrick(forced)) return true;
  return rng() < TRICK_OR_TREAT_TRICK_CHANCE;
}

function weightedPick(entries, rng) {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

// noTreat must always pass canApply, since it is the last resort.
function pickTrick(canApply, rng = Math.random, forced = TRICK_OR_TREAT_FORCE_OUTCOME) {
  const first = forcedTrick(forced) ?? weightedPick(TRICKS, rng);
  if (canApply(first.id)) return first.id;

  const sameTier = TRICKS.filter(t => t.tier === first.tier && canApply(t.id));
  if (sameTier.length) return weightedPick(sameTier, rng).id;

  const mild = TRICKS.filter(t => t.tier === "mild" && canApply(t.id));
  return mild.length ? weightedPick(mild, rng).id : "noTreat";
}

const CUSTOM_EMOJI = /^<a?:\w{2,32}:(\d{17,20})>$/;
const MAX_REACTIONS = 20;

function customEmojiId(emoji) {
  return CUSTOM_EMOJI.exec(emoji)?.[1] ?? null;
}

// Discord rejects a duplicate reaction on one message and caps a message at 20 distinct ones.
function normalizeCombos(combos) {
  if (!Array.isArray(combos)) return [];
  return combos
    .filter(Array.isArray)
    .map(combo => [...new Set(combo.filter(e => typeof e === "string").map(e => e.trim()).filter(Boolean))].slice(0, MAX_REACTIONS))
    .filter(combo => combo.length > 0);
}

function pickCombo(combos, rng = Math.random) {
  if (!combos.length) return [];
  return combos[Math.floor(rng() * combos.length)];
}

function theftSplit(wallet, bank) {
  const safeWallet = Math.max(Number(wallet) || 0, 0);
  const safeBank = Math.max(Number(bank) || 0, 0);
  const amount = Math.floor((safeWallet + safeBank) * TRICK_OR_TREAT_THEFT_RATE);
  const fromWallet = Math.min(amount, safeWallet);
  return { amount, fromWallet, fromBank: amount - fromWallet };
}

module.exports = {
  TRICKS,
  isEventActive,
  nextOpeningEpoch,
  nextUtcMidnightMs,
  canClaim,
  wealthBonus,
  rollTreat,
  isTrick,
  pickTrick,
  theftSplit,
  customEmojiId,
  normalizeCombos,
  pickCombo,
};
