/**
 * Unified inventory/shop facade.
 *
 * All ownable items across every category (themes today, card backs/slot
 * sounds/etc tomorrow) flow through this module.  Commands (`/shop`,
 * `/inventory`, `/theme`, `/unlockall`) never touch the per-category
 * managers directly -- they call the generic helpers here, and this module
 * dispatches to the right manager based on the item's `category`.
 */

const { EmbedBuilder } = require("discord.js");
const { db } = require("../database");

const { CURRENCY_NAME } = require("../config.js");
const { getThemeList, getTheme } = require("../themes/configs");
const { getThemeColors } = require("../themes/resolver");
const {
  equipTheme, grantTheme, revokeTheme, ownsTheme,
  getOwnedThemes, getEquippedTheme,
} = require("../themes/manager");

// ── Rarity tiers (derived from item weight) ─────────────────────────
// Higher weight = more common in the shop.  Rarity is walked
// descending by `min`; first match wins.
const RARITY = {
  limited:   { label: "LIMITED!",   color: 0xe74c3c, order: 4, min: null },
  legendary: { label: "Legendary", color: 0xf59e0b, order: 3, min: 1  },
  rare:      { label: "Rare",      color: 0x3b82f6, order: 2, min: 3  },
  uncommon:  { label: "Uncommon",  color: 0x3fa34d, order: 1, min: 15 },
  common:    { label: "Common",    color: 0x9aa0a6, order: 0, min: 40 },
};

const RARITY_ORDER = Object.keys(RARITY).sort((a, b) => RARITY[b].order - RARITY[a].order);

const SHOP_SIZE = 6;
const _shopCache = new Map(); // key: `${guildId}:${dateKey}` -> item[]

function getRarity(weight) {
  if (weight === null || weight === undefined) return "limited";
  if (!weight || weight <= 0) return null;
  // Walk by ascending `min` so "common" (largest min) is matched first for
  // high-weight items.  Rarity buckets are: legendary<rare<uncommon<common
  // in min-weight terms: 1 <= 3 <= 15 <= 40.
  const keys = Object.keys(RARITY).sort((a, b) => RARITY[b].min - RARITY[a].min);
  for (const key of keys) {
    if (weight >= RARITY[key].min) return key;
  }
  return "legendary";
}

// ── Item registry ───────────────────────────────────────────────────
// Every category registers a list builder that returns `{id, name,
// description, price, weight, ...extra}` objects.  Adding a new category
// means adding another `collectXxx()` call here.
function collectThemeItems() {
  return getThemeList().map(t => ({
    id:          t.id,
    name:        t.name,
    description: t.description,
    category:    "theme",
    tier:        t.tier,
    price:       t.price,
    weight:      t.weight,
    emoji:       t.emoji || "",
    rarity:      getRarity(t.weight),
    availability: t.availability || null,
    raw:         t,
  }));
}

function getAllItems() {
  return [
    ...collectThemeItems(),
  ];
}

function getItemById(id) {
  return getAllItems().find(item => item.id === id) || null;
}

function getPurchasableItems(date = new Date()) {
  return getAllItems().filter(i => {
    if (i.tier === "limited") {
      return i.price > 0 && i.availability && isThemeAvailable(i.availability, date);
    }
    return i.weight > 0 && i.price > 0;
  });
}

// ── Category dispatch ───────────────────────────────────────────────
async function ownsItem(userId, itemId) {
  const item = getItemById(itemId);
  if (!item) return false;
  switch (item.category) {
    case "theme": return ownsTheme(userId, itemId);
    default:      return false;
  }
}

async function grantItem(userId, itemId) {
  const item = getItemById(itemId);
  if (!item) return { success: false, error: "unknown_item" };
  switch (item.category) {
    case "theme": await grantTheme(userId, itemId); return { success: true };
    default:      return { success: false, error: "unknown_category" };
  }
}

async function revokeItem(userId, itemId) {
  const item = getItemById(itemId);
  if (!item) return { success: false, error: "unknown_item" };
  switch (item.category) {
    case "theme": await revokeTheme(userId, itemId); return { success: true };
    default:      return { success: false, error: "unknown_category" };
  }
}

async function equipItem(userId, itemId) {
  const item = getItemById(itemId);
  if (!item) return { success: false, error: "unknown_item" };
  switch (item.category) {
    case "theme": return equipTheme(userId, itemId);
    default:      return { success: false, error: "unknown_category" };
  }
}

async function getOwnedItems(userId) {
  const ownedThemes = await getOwnedThemes(userId);
  const all = getAllItems();
  return all.filter(i =>
    (i.category === "theme" && ownedThemes.includes(i.id))
  );
}

async function getEquipped(userId) {
  return {
    theme: await getEquippedTheme(userId),
  };
}

// ── Availability helpers (limited themes) ─────────────────────────────
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

function isThemeAvailable(availability, date = new Date()) {
  const nowMs = todayMs(date);
  return normalizeAvailability(availability)
    .some(range => isRangeActive(resolveRange(range, date), nowMs));
}

// Unix epoch (seconds) at which the currently open window closes, or null when
// no window is open.  Mirrors the end-of-window math in isThemeAvailable so the
// "available until" deadline lines up exactly with when purchasing stops being
// allowed.  With overlapping ranges the latest close wins, so the deadline never
// understates how long the theme is actually buyable.
function availabilityEndEpoch(availability, date = new Date()) {
  const nowMs = todayMs(date);
  let latest = null;

  for (const range of normalizeAvailability(availability)) {
    const r = resolveRange(range, date);
    if (!isRangeActive(r, nowMs)) continue;

    let endMs = r.endMs;
    // Year-wrap (recurring themes, e.g. Dec 20 → Jan 5): while still in the
    // December head of the window, the window actually closes next January.
    if (r.startMs > r.endMs && !r.endYearPinned && nowMs >= r.startMs) {
      endMs = Date.UTC(r.endYear + 1, r.endMonth - 1, r.endDay, 23, 59, 59, 999);
    }
    if (latest === null || endMs > latest) latest = endMs;
  }

  return latest === null ? null : Math.floor(latest / 1000);
}

// Whether a limited theme is tied to specific years (a one-time event that will
// not come back) versus having a recurring window.  A single recurring range is
// enough to bring the theme back, so this only holds when *every* range is
// year-pinned.
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

// ── Daily shop stock ────────────────────────────────────────────────
function dateKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// 53-bit string hash (cyrb53).
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// Seeded PRNG (mulberry32).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Roulette-wheel pick without replacement.
function weightedSample(pool, count, rng) {
  const items = pool.slice();
  const picked = [];
  const n = Math.min(count, items.length);
  for (let i = 0; i < n; i++) {
    const total = items.reduce((acc, it) => acc + it.weight, 0);
    if (total <= 0) break;
    let r = rng() * total;
    let idx = 0;
    for (; idx < items.length; idx++) {
      r -= items[idx].weight;
      if (r <= 0) break;
    }
    if (idx >= items.length) idx = items.length - 1;
    picked.push(items[idx]);
    items.splice(idx, 1);
  }
  return picked;
}

function getDailyShopStock(guildId, date = new Date()) {
  const key = `${guildId}:${dateKey(date)}`;
  if (_shopCache.has(key)) return _shopCache.get(key);

  const allPurchasable = getPurchasableItems(date);

  // Weighted pool: only items with numeric weight > 0
  const weightedPool = allPurchasable.filter(i => i.weight > 0);
  const seed = cyrb53(key);
  const rng = mulberry32(seed);
  const picked = weightedSample(weightedPool, SHOP_SIZE, rng);

  // Limited items: currently in-season, always appear (additive, don't consume a slot)
  const limitedItems = allPurchasable.filter(i => i.tier === "limited");

  const stock = [...limitedItems, ...picked];
  stock.sort((a, b) => {
    const ar = RARITY[a.rarity]?.order ?? -1;
    const br = RARITY[b.rarity]?.order ?? -1;
    if (br !== ar) return br - ar;
    return a.name.localeCompare(b.name);
  });

  _shopCache.set(key, stock);
  return stock;
}

function nextShopResetEpoch(date = new Date()) {
  const next = new Date(Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0, 0,
  ));
  return Math.floor(next.getTime() / 1000);
}

// ── Purchase flow ───────────────────────────────────────────────────
async function purchaseItem(userId, guildId, itemId) {
  const item = getItemById(itemId);
  if (!item) return { success: false, error: "unknown_item" };

  if (item.tier === "limited" && item.availability && !isThemeAvailable(item.availability)) {
    return { success: false, error: "not_in_season", item };
  }

  const stock = getDailyShopStock(guildId);
  if (!stock.some(s => s.id === itemId)) {
    return { success: false, error: "not_in_stock", item };
  }

  if (await ownsItem(userId, itemId)) {
    return { success: false, error: "already_owned", item };
  }

  // Atomic deduct-then-check: subtract first, then verify balance didn't go negative.
  // This prevents two concurrent purchases both passing the balance check.
  await db.sub(`${userId}.balance`, item.price);
  const newBalance = (await db.get(`${userId}.balance`)) ?? 0;
  if (newBalance < 0) {
    // Refund — not enough funds
    await db.add(`${userId}.balance`, item.price);
    return { success: false, error: "insufficient_funds", item, balance: newBalance + item.price };
  }

  const grant = await grantItem(userId, itemId);
  if (!grant.success) {
    // Refund on grant failure
    await db.add(`${userId}.balance`, item.price);
    return { success: false, error: grant.error, item };
  }

  await db.add(`${userId}.stats.shop.purchases`, 1);
  await db.add(`${userId}.stats.shop.spent`, item.price);
  const biggest = (await db.get(`${userId}.stats.shop.biggestPurchase`)) ?? 0;
  if (item.price > biggest) {
    await db.set(`${userId}.stats.shop.biggestPurchase`, item.price);
  }

  return { success: true, item, newBalance };
}

// ── Shared command helpers ────────────────────────────────────────────

function buildFooter(interaction) {
  return {
    text: `${interaction.client.user.username} | Version ${require("../package.json").version}`,
    iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }),
  };
}

function formatPrice(price) {
  return price === 0 ? "Free!" : `${price.toLocaleString("en-US")} ${CURRENCY_NAME}`;
}

const TIER_LABELS = {
  colorway: "Colorway",
  styled:   "Styled",
  full:     "Full",
  limited:  "Limited",
};

const CATEGORY_LABELS = {
  theme: "Themes",
};

function renderThemeSwatch(themeId) {
  const colors = getThemeColors(themeId, "slots");
  const swatch = [colors.feltColor, colors.gold, colors.textWin, colors.textLoss]
    .filter(Boolean)
    .map(c => `\`${c}\``)
    .join("  ");
  const embedColor = colors.embedColor || parseInt(String(colors.feltColor).replace("#", ""), 16) || 0x5865F2;
  return { swatch, embedColor };
}

function buildThemeInfoEmbed({ item, isOwned, footer }) {
  const { swatch, embedColor } = renderThemeSwatch(item.id);
  const rarityLabel = item.rarity ? RARITY[item.rarity].label : "Default";
  const styleLabel = TIER_LABELS[item.tier] || item.tier;

  let desc = `${item.description}\n\n`;
  desc += `**Rarity:** ${rarityLabel}\n`;
  desc += `**Style:** ${styleLabel}\n`;
  if (item.tier === "limited" && item.availability) {
    const inSeason = isThemeAvailable(item.availability);
    desc += `**Availability:** ${formatAvailability(item.availability)}\n`;
    desc += `**Season:** ${inSeason ? "In Season" : "Out of Season"}\n`;
    if (inSeason) {
      const until = availabilityEndEpoch(item.availability);
      const gone = isOneTimeAvailability(item.availability) ? " ⚠️ Won't return" : "";
      desc += `**Available until:** <t:${until}:f> (<t:${until}:R>)${gone}\n`;
    }
  }
  desc += `**Price:** ${formatPrice(item.price)}\n`;
  desc += `**Status:** ${isOwned ? "Owned" : "Not Owned"}\n`;
  desc += `\n**Sample Colors:**\n${swatch}`;

  const embed = new EmbedBuilder()
    .setTitle(`${item.emoji ? `${item.emoji} ` : ""}${item.name}`)
    .setDescription(desc)
    .setColor(embedColor)
    .setTimestamp();
  if (footer) embed.setFooter(footer);
  return embed;
}

function buildEquipResultEmbed({ result, itemId, user, footer }) {
  const item = getItemById(itemId);
  const name = item?.name || itemId;
  const prefix = item?.emoji ? `${item.emoji} ` : "";

  if (!result.success) {
    let desc;
    switch (result.error) {
      case "unknown_item":
      case "unknown_theme":  desc = `Unknown item \`${itemId}\`.`; break;
      case "not_owned":      desc = `You don't own ${prefix}**${name}**.\nCheck \`/shop browse\` to purchase it!`; break;
      case "unknown_category": desc = `**${name}** can't be equipped.`; break;
      case "write_failed":   desc = "Failed to save your theme selection. Please try again."; break;
      default:               desc = `Equip failed: \`${result.error}\`.`;
    }
    const embed = new EmbedBuilder()
      .setDescription(desc)
      .setColor(0xFF0000)
      .setTimestamp();
    if (footer) embed.setFooter(footer);
    return { embed, ephemeral: true };
  }

  const embed = new EmbedBuilder()
    .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
    .setDescription(`Equipped ${prefix}**${name}**!${item?.description ? `\n${item.description}` : ""}`)
    .setColor(0x00FF00)
    .setTimestamp();
  if (footer) embed.setFooter(footer);
  return { embed, ephemeral: true };
}

async function respondThemeAutocomplete(interaction, { onlyOwned = false } = {}) {
  const focused = interaction.options.getFocused().toLowerCase();
  const pool = onlyOwned
    ? await getOwnedThemes(interaction.user.id)
    : getThemeList().map(t => t.id);
  const filtered = pool
    .filter(id => id.toLowerCase().startsWith(focused))
    .slice(0, 25)
    .map(id => {
      const item = getItemById(id);
      return { name: item?.name || id, value: id };
    });
  await interaction.respond(filtered);
}

// ── Game preview helpers (shared by /theme info and /shop preview) ─────

const PREVIEW_GAMES = ["slots", "roulette", "poker", "blackjack", "craps", "duel"];
const GAME_LABELS = {
  slots: "Slots", roulette: "Roulette", poker: "Poker",
  blackjack: "Blackjack", craps: "Craps", duel: "Duel",
};
const GAME_EMOJIS = {
  slots: "\u{1F3B0}", roulette: "\u{1F3B2}", poker: "\u{1F0CF}",
  blackjack: "\u{1F0A1}", craps: "\u{1F3B2}", duel: "\u{2694}",
};
const GAME_FILES = {
  slots: "slots-result.png", roulette: "roulette.png", poker: "hand.png",
  blackjack: "blackjack.png", craps: "craps.png", duel: "duel.png",
};

const MAX_PREVIEW_CACHE = 50;
const _previewCache = new Map();

async function getPreviewAttachment(themeId, game, user = null, clientUser = null) {
  const uid = user ? user.id : "";
  const cid = clientUser ? clientUser.id : "";
  const key = `${themeId}-${game}-${uid}-${cid}`;
  if (_previewCache.has(key)) return _previewCache.get(key);
  let attachment = null;
  try {
    const { slotsPreview } = require("./slotsCanvas");
    const { roulettePreview } = require("./roulette");
    const { pokerPreview } = require("./poker");
    const { blackjackPreview } = require("./blackjackCanvas");
    const { crapsPreview } = require("./crapsCanvas");
    const { duelPreview } = require("./duelCanvas");
    switch (game) {
      case "slots":     attachment = await slotsPreview(themeId); break;
      case "roulette":  attachment = await roulettePreview(themeId); break;
      case "poker":     attachment = await pokerPreview(themeId, user); break;
      case "blackjack": attachment = await blackjackPreview(themeId, user, clientUser); break;
      case "craps":     attachment = await crapsPreview(themeId, user, clientUser); break;
      case "duel":      attachment = await duelPreview(themeId, user, clientUser); break;
    }
  } catch (err) {
    // Lazy-load may fail if canvas deps are missing; non-fatal
  }
  _previewCache.set(key, attachment);
  if (_previewCache.size > MAX_PREVIEW_CACHE) {
    const oldest = _previewCache.keys().next().value;
    _previewCache.delete(oldest);
  }
  return attachment;
}

module.exports = {
  RARITY,
  RARITY_ORDER,
  SHOP_SIZE,
  TIER_LABELS,
  CATEGORY_LABELS,
  PREVIEW_GAMES,
  GAME_LABELS,
  GAME_EMOJIS,
  GAME_FILES,
  getRarity,
  buildFooter,
  formatPrice,
  renderThemeSwatch,
  buildThemeInfoEmbed,
  buildEquipResultEmbed,
  respondThemeAutocomplete,
  getPreviewAttachment,
  isThemeAvailable,
  formatAvailability,
  availabilityEndEpoch,
  isOneTimeAvailability,
  normalizeAvailability,
  getAllItems,
  getItemById,
  getPurchasableItems,
  ownsItem,
  grantItem,
  revokeItem,
  equipItem,
  getOwnedItems,
  getEquipped,
  getDailyShopStock,
  nextShopResetEpoch,
  purchaseItem,
};
