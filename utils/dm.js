const logger = require("./logger");
const { getSettingValue } = require("./settings");

/**
 * Send a DM to a user if they have DMs enabled.
 * @param {import("discord.js").User} user - A discord.js User instance.
 * @param {import("discord.js").MessageCreateOptions|string|object} payload - Message payload.
 * @returns {Promise<import("discord.js").Message|null>} The sent message, or null if disabled/failed.
 */
async function sendDM(user, payload) {
  if (!user || !user.id) return null;
  const userId = user.id;

  const allowed = await getSettingValue(userId, "dms");
  if (!allowed) {
    logger.debug(`[DM] Silently dropping DM to ${userId} — DMs disabled in settings.`);
    return null;
  }

  try {
    return await user.send(payload);
  } catch (err) {
    logger.warn(`[DM] Failed to send DM to ${userId}: ${err.message}`);
    return null;
  }
}

module.exports = { sendDM };
