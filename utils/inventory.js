/**
 * Unified inventory/shop facade.
 *
 * All ownable items across every category (themes today, card backs/slot
 * sounds/etc tomorrow) flow through this module.  Commands (`/shop`,
 * `/inventory`, `/theme`, `/unlockall`) never touch the per-category
 * managers directly -- they call the generic helpers here, and this module
 * dispatches to the right manager based on the item's `category`.
 */

const { QuickDB } = require('quick.db');
const db = new QuickDB({ filePath: './db/users.sqlite' });

const { getThemeList, getTheme } = require('../themes/configs');
const {
    equipTheme, grantTheme, revokeTheme, ownsTheme,
    getOwnedThemes, getEquippedTheme,
} = require('../themes/manager');

// ── Rarity tiers (derived from item weight) ─────────────────────────
// Higher weight = more common in the shop.  Rarity is walked
// descending by `min`; first match wins.
const RARITY = {
    limited:   { label: 'LIMITED!',   color: 0xe74c3c, order: 4, min: null },
    legendary: { label: 'Legendary', color: 0xf59e0b, order: 3, min: 1  },
    rare:      { label: 'Rare',      color: 0x3b82f6, order: 2, min: 3  },
    uncommon:  { label: 'Uncommon',  color: 0x3fa34d, order: 1, min: 15 },
    common:    { label: 'Common',    color: 0x9aa0a6, order: 0, min: 40 },
};

const RARITY_ORDER = Object.keys(RARITY).sort((a, b) => RARITY[b].order - RARITY[a].order);

const SHOP_SIZE = 6;
const _shopCache = new Map(); // key: `${guildId}:${dateKey}` -> item[]

function getRarity(weight) {
    if (weight === null || weight === undefined) return 'limited';
    if (!weight || weight <= 0) return null;
    // Walk by ascending `min` so "common" (largest min) is matched first for
    // high-weight items.  Rarity buckets are: legendary<rare<uncommon<common
    // in min-weight terms: 1 <= 3 <= 15 <= 40.
    const keys = Object.keys(RARITY).sort((a, b) => RARITY[b].min - RARITY[a].min);
    for (const key of keys) {
        if (weight >= RARITY[key].min) return key;
    }
    return 'legendary';
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
        category:    'theme',
        tier:        t.tier,
        price:       t.price,
        weight:      t.weight,
        emoji:       t.emoji || '',
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
        if (i.tier === 'limited') {
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
        case 'theme': return ownsTheme(userId, itemId);
        default:      return false;
    }
}

async function grantItem(userId, itemId) {
    const item = getItemById(itemId);
    if (!item) return { success: false, error: 'unknown_item' };
    switch (item.category) {
        case 'theme': await grantTheme(userId, itemId); return { success: true };
        default:      return { success: false, error: 'unknown_category' };
    }
}

async function revokeItem(userId, itemId) {
    const item = getItemById(itemId);
    if (!item) return { success: false, error: 'unknown_item' };
    switch (item.category) {
        case 'theme': await revokeTheme(userId, itemId); return { success: true };
        default:      return { success: false, error: 'unknown_category' };
    }
}

async function equipItem(userId, itemId) {
    const item = getItemById(itemId);
    if (!item) return { success: false, error: 'unknown_item' };
    switch (item.category) {
        case 'theme': return equipTheme(userId, itemId);
        default:      return { success: false, error: 'unknown_category' };
    }
}

async function getOwnedItems(userId) {
    const ownedThemes = await getOwnedThemes(userId);
    const all = getAllItems();
    return all.filter(i =>
        (i.category === 'theme' && ownedThemes.includes(i.id))
    );
}

async function getEquipped(userId) {
    return {
        theme: await getEquippedTheme(userId),
    };
}

// ── Availability helpers (limited themes) ─────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function isThemeAvailable(availability, date = new Date()) {
    if (!availability) return false;
    const { start, end } = availability;
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + 1;
    const d = date.getUTCDate();

    const startYear = start.year ?? y;
    const endYear = end.year ?? (start.year ? end.year ?? start.year : y);

    const startMonth = start.month;
    const startDay = start.day ?? 1;
    const endMonth = end.month;
    const endDay = end.day ?? new Date(endYear, endMonth, 0).getUTCDate();

    const startMs = Date.UTC(startYear, startMonth - 1, startDay);
    const endMs = Date.UTC(endYear, endMonth - 1, endDay, 23, 59, 59, 999);
    const nowMs = Date.UTC(y, m - 1, d);

    // Year-wrap: e.g. Dec 20 → Jan 5
    if (startMs > endMs) {
        return nowMs >= startMs || nowMs <= endMs;
    }
    return nowMs >= startMs && nowMs <= endMs;
}

function formatAvailability(availability) {
    if (!availability) return '';
    const { start, end } = availability;
    const hasYear = start.year != null || end.year != null;
    const hasDay = start.day != null && end.day != null;
    const isYearly = !hasYear;

    const fmtStart = start.day
        ? `${MONTHS[start.month - 1]} ${start.day}`
        : MONTHS[start.month - 1];
    const fmtEnd = end.day
        ? `${MONTHS[end.month - 1]} ${end.day}`
        : MONTHS[end.month - 1];

    let str;
    if (fmtStart === fmtEnd) {
        str = fmtStart;
    } else {
        str = `${fmtStart} - ${fmtEnd}`;
    }

    if (hasYear) {
        const yr = end.year || start.year;
        str += `, ${yr}`;
    } else if (isYearly) {
        str += ' (yearly)';
    }

    return str;
}

// ── Daily shop stock ────────────────────────────────────────────────
function dateKey(date = new Date()) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
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
    const limitedItems = allPurchasable.filter(i => i.tier === 'limited');

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

function msUntilNextShopReset(date = new Date()) {
    const next = new Date(Date.UTC(
        date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0, 0,
    ));
    return next.getTime() - date.getTime();
}

// ── Purchase flow ───────────────────────────────────────────────────
async function purchaseItem(userId, guildId, itemId) {
    const item = getItemById(itemId);
    if (!item) return { success: false, error: 'unknown_item' };

    if (item.tier === 'limited' && item.availability && !isThemeAvailable(item.availability)) {
        return { success: false, error: 'not_in_season', item };
    }

    const stock = getDailyShopStock(guildId);
    if (!stock.some(s => s.id === itemId)) {
        return { success: false, error: 'not_in_stock', item };
    }

    if (await ownsItem(userId, itemId)) {
        return { success: false, error: 'already_owned', item };
    }

    const balance = (await db.get(`${userId}.balance`)) ?? 0;
    if (balance < item.price) {
        return { success: false, error: 'insufficient_funds', item, balance };
    }

    await db.sub(`${userId}.balance`, item.price);
    const grant = await grantItem(userId, itemId);
    if (!grant.success) return { success: false, error: grant.error, item };

    await db.add(`${userId}.stats.shop.purchases`, 1);
    await db.add(`${userId}.stats.shop.spent`, item.price);
    const biggest = (await db.get(`${userId}.stats.shop.biggestPurchase`)) ?? 0;
    if (item.price > biggest) {
        await db.set(`${userId}.stats.shop.biggestPurchase`, item.price);
    }

    const newBalance = (await db.get(`${userId}.balance`)) ?? 0;
    return { success: true, item, newBalance };
}

module.exports = {
    RARITY,
    RARITY_ORDER,
    SHOP_SIZE,
    getRarity,
    isThemeAvailable,
    formatAvailability,
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
    msUntilNextShopReset,
    purchaseItem,
};
