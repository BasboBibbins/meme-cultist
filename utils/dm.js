const logger = require("./logger");
const { getSettingValue } = require("./settings");

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
