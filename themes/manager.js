/**
 * Theme ownership and equip helpers (QuickDB).
 *
 * DB paths:
 *   ${userId}.profile.theme.equipped  -> string    (default: 'classic')
 *   ${userId}.profile.theme.owned     -> string[]
 *
 * Classic is always implicitly owned -- no DB entry required.
 */

const { db } = require('../database');
const { getTheme } = require('./configs');
const logger = require('../utils/logger');

const DEFAULT_THEME = 'classic';

// Per-user mutex to prevent TOCTOU in grant/revoke operations
const _locks = new Map();

async function withUserLock(userId, fn) {
    while (_locks.has(userId)) {
        await _locks.get(userId);
    }
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    _locks.set(userId, promise);
    try {
        return await fn();
    } finally {
        _locks.delete(userId);
        resolve();
    }
}

/**
 * Get the user's currently equipped theme ID.
 */
async function getEquippedTheme(userId) {
    const val = await db.get(`${userId}.profile.theme.equipped`);
    return val || DEFAULT_THEME;
}

/**
 * Get the list of theme IDs the user owns (classic is always included).
 */
async function getOwnedThemes(userId) {
    let owned = (await db.get(`${userId}.profile.theme.owned`));
    if (!Array.isArray(owned)) {
        owned = [];
    }
    if (!owned.includes(DEFAULT_THEME)) {
        owned = [DEFAULT_THEME, ...owned];
    }
    return owned;
}

/**
 * Check whether a user owns a specific theme.
 */
async function ownsTheme(userId, themeId) {
    if (themeId === DEFAULT_THEME) return true;
    const owned = (await db.get(`${userId}.profile.theme.owned`));
    if (!Array.isArray(owned)) return false;
    return owned.includes(themeId);
}

/**
 * Equip a theme.  Returns { success, error? }.
 */
async function equipTheme(userId, themeId) {
    return withUserLock(userId, async () => {
        const theme = getTheme(themeId);
        if (theme.id !== themeId) {
            return { success: false, error: 'unknown_theme' };
        }
        if (!(await ownsTheme(userId, themeId))) {
            return { success: false, error: 'not_owned' };
        }
        await db.set(`${userId}.profile.theme.equipped`, themeId);

        // Verify the write persisted
        const verify = await db.get(`${userId}.profile.theme.equipped`);
        if (verify !== themeId) {
            logger.error(`[themes] equipTheme verification failed for user ${userId}: wrote "${themeId}" but read "${verify}"`);
            // Retry once
            await db.set(`${userId}.profile.theme.equipped`, themeId);
            const retryVerify = await db.get(`${userId}.profile.theme.equipped`);
            if (retryVerify !== themeId) {
                logger.error(`[themes] equipTheme retry also failed for user ${userId}: wrote "${themeId}" but read "${retryVerify}"`);
                return { success: false, error: 'write_failed' };
            }
        }

        logger.debug(`[themes] ${userId} equipped theme "${themeId}"`);
        return { success: true };
    });
}

/**
 * Grant a theme to a user (used by shop on purchase).
 */
async function grantTheme(userId, themeId) {
    return withUserLock(userId, async () => {
        let owned = (await db.get(`${userId}.profile.theme.owned`));
        if (!Array.isArray(owned)) {
            owned = [];
        }
        if (!owned.includes(themeId)) {
            owned.push(themeId);
            await db.set(`${userId}.profile.theme.owned`, owned);
        }
    });
}

/**
 * Revoke a theme from a user (admin use).
 * If the revoked theme was equipped, resets to classic.
 */
async function revokeTheme(userId, themeId) {
    return withUserLock(userId, async () => {
        if (themeId === DEFAULT_THEME) return;
        let owned = (await db.get(`${userId}.profile.theme.owned`));
        if (!Array.isArray(owned)) {
            owned = [];
        }
        const idx = owned.indexOf(themeId);
        if (idx !== -1) {
            owned.splice(idx, 1);
            await db.set(`${userId}.profile.theme.owned`, owned);
        }
        const equipped = await getEquippedTheme(userId);
        if (equipped === themeId) {
            await db.set(`${userId}.profile.theme.equipped`, DEFAULT_THEME);
        }
    });
}

module.exports = {
    getEquippedTheme,
    getOwnedThemes,
    ownsTheme,
    equipTheme,
    grantTheme,
    revokeTheme,
    DEFAULT_THEME,
};
