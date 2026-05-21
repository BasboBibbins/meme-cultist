const { db } = require("../database");

const SETTINGS_REGISTRY = {
  dms: {
    dbKey: "dmsEnabled",
    label: "Direct Messages",
    description: "Allow the bot to send you DMs for game results, transfers, reminders, and notifications.",
    default: true,
    emoji: "📩",
  },
};

async function getUserSettings(userId) {
  const raw = (await db.get(`${userId}.settings`)) || {};
  const result = {};
  for (const [id, meta] of Object.entries(SETTINGS_REGISTRY)) {
    result[id] = {
      ...meta,
      value: raw[meta.dbKey] !== undefined ? raw[meta.dbKey] : meta.default,
    };
  }
  return result;
}

async function getSettingValue(userId, settingId) {
  const meta = SETTINGS_REGISTRY[settingId];
  if (!meta) return undefined;
  const raw = await db.get(`${userId}.settings.${meta.dbKey}`);
  return raw !== undefined ? raw : meta.default;
}

async function setSettingValue(userId, settingId, value) {
  const meta = SETTINGS_REGISTRY[settingId];
  if (!meta) throw new Error(`Unknown setting: ${settingId}`);
  await db.set(`${userId}.settings.${meta.dbKey}`, value);
  return { meta, value };
}

async function toggleSetting(userId, settingId) {
  const current = await getSettingValue(userId, settingId);
  const newValue = !current;
  await setSettingValue(userId, settingId, newValue);
  return { meta: SETTINGS_REGISTRY[settingId], newValue };
}

module.exports = {
  SETTINGS_REGISTRY,
  getUserSettings,
  getSettingValue,
  setSettingValue,
  toggleSetting,
};
