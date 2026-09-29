const { QuickDB } = require("quick.db");
const moment = require("moment");
const { GUILD_ID, CLEANUP_INACTIVE_DAYS, CLEANUP_JACKPOT_SHARE, INTEREST_ACTIVE_WINDOW_DAYS } = require("./config.js");
const { ensureDbDir } = require("./utils/dbDir");
ensureDbDir();
const db = new QuickDB({ filePath: "./db/users.sqlite" });
const logger = require("./utils/logger");
const { isPlayerRow, holdings, isLongInactive, planCleanup, splitPot } = require("./utils/dbCleanup");
const { addToJackpot } = require("./utils/jackpot");
const { withUserLock } = require("./utils/userlock");

// Read the user's stats.commands subtree, clear any buckets whose period has
// rolled over, and persist if anything changed. Returns the in-memory object so
// callers can mutate further (e.g. increment a counter) and write once.
// Idempotent — safe to call from /stats, the post-command handler, or a startup sweep.
async function applyCommandStatsResets(userId) {
  const commands = (await db.get(`${userId}.stats.commands`)) || {};

  const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (!isPlainObject(commands.total)) commands.total = {};
  if (!isPlainObject(commands.daily)) commands.daily = {};
  if (!isPlainObject(commands.monthly)) commands.monthly = {};
  if (!isPlainObject(commands.yearly)) commands.yearly = {};

  const now = moment();
  const today = now.format("YYYY-MM-DD");
  const thisMonth = now.format("YYYY-MM");
  const thisYear = now.format("YYYY");

  let changed = false;
  if (commands.dailyReset !== today) {
    commands.dailyReset = today;
    commands.daily = {};
    changed = true;
  }
  if (commands.monthlyReset !== thisMonth) {
    commands.monthlyReset = thisMonth;
    commands.monthly = {};
    changed = true;
  }
  if (commands.yearlyReset !== thisYear) {
    commands.yearlyReset = thisYear;
    commands.yearly = {};
    changed = true;
  }

  if (changed) await db.set(`${userId}.stats.commands`, commands);
  return commands;
}

async function getDefaultDB(user) {
  return {
    "id": user.id,
    "name": user.username+"#"+user.discriminator,
    "balance": 0,
    "bank": 100,
    "inventory": [],
    "cooldowns": {
      "daily": 0,
      "weekly": 0,
      "rob": 0,
      "freespins": 0,
      "trickortreat": 0,
    },
    "stats": {
      "commands": {
        "dailyReset": 0,
        "monthlyReset": 0,
        "yearlyReset": 0,
        "daily": {},
        "monthly": {},
        "yearly": {},
        "total": {},
      },
      "dailies": {
        "claimed": 0,
        "currentStreak": 0,
        "longestStreak": 0,
      },
      "weeklies": {
        "claimed": 0,
      },
      "blackjack": {
        "wins": 0,
        "losses": 0,
        "ties": 0,
        "blackjacks": 0,
        "biggestWin": 0,
        "biggestLoss": 0,
        "profit": 0,
      },
      "slots": {
        "wins": 0,
        "losses": 0,
        "jackpots": 0,
        "biggestWin": 0,
        "biggestLoss": 0,
        "profit": 0,
      },
      "flip": {
        "wins": 0,
        "losses": 0,
        "biggestWin": 0,
        "biggestLoss": 0,
        "profit": 0,
      },
      "roulette": {
        "wins": 0,
        "losses": 0,
        "biggestWin": 0,
        "biggestLoss": 0,
        "totalBet": 0,
        "profit": 0,
      },
      "race": {
        "wins": 0,
        "losses": 0,
        "biggestWin": 0,
        "biggestLoss": 0,
        "biggestWinHorse": null,
        "biggestLossHorse": null,
        "totalBet": 0,
        "profit": 0,
      },
      "craps": {
        "rolls": 0,
        "wins": 0,
        "losses": 0,
        "pushes": 0,
        "pointsHit": 0,
        "sevenOuts": 0,
        "biggestWin": 0,
        "biggestLoss": 0,
        "totalBet": 0,
        "profit": 0,
      },
      "poker": {
        "wins": 0,
        "losses": 0,
        "royals": 0,
        "biggestWin": 0,
        "biggestLoss": 0,
        "profit": 0,
      },
      "duel": {
        "wins": 0,
        "losses": 0,
        "draws": 0,
        "biggestWin": 0,
        "biggestLoss": 0,
        "profit": 0,
        "totalBet": 0,
      },
      "keno": {
        "wins": 0,
        "losses": 0,
        "pushes": 0,
        "biggestWin": 0,
        "biggestLoss": 0,
        "totalBet": 0,
        "profit": 0,
      },
      "begs": {
        "wins": 0,
        "losses": 0,
        "profit": 0,
      },
      "shop": {
        "purchases": 0,
        "spent": 0,
        "biggestPurchase": 0,
      },
      "halloween": {
        "claimed": 0,
        "treats": 0,
        "tricks": 0,
        "earned": 0,
        "lost": 0,
      },
      "interest": {
        "earned": 0,
        "lastAmount": 0,
        "lastAt": 0,
      },
      "lastCommand": {
        "name": "",
        "at": 0,
      },
      "largestBalance": 0,
      "largestBank": 0,
    },
    "profile": {
      "theme": {
        "equipped": "classic",
        "owned": [],
      },
    },
    "settings": {
      "dmsEnabled": true,
    },
    "chatbot": {
      messageCount: 0,
      summaries: [],
      facts: [],
      messagesSinceLastSummary: 0,
      messagesSinceLastFacts: 0,
      incognitoMode: false,
      incognitoChannels: [],
    },
    "slots": {
      "lastBet": "",
      "lastLines": 1,
    },
    "race": {
      "lastBet": "",
      "lastBetType": "win",
    },
    "poker": {
      "lastBet": "",
    },
    "blackjack": {
      "lastBet": "",
    },
    "craps": {
      "lastBet": "",
    },
    "keno": {
      "lastBet": "",
      "lastSpots": [],
    },
  };
}
// Fills fields missing up to three levels deep without touching existing data.
function mergeDefaults(row, defaults) {
  let updated = false;
  const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
  for (const [key, value] of Object.entries(defaults)) {
    if (row[key] === undefined || row[key] === null) {
      row[key] = value;
      updated = true;
    } else if (isObject(row[key]) && isObject(value)) {
      for (const [subKey, subValue] of Object.entries(value)) {
        if (row[key][subKey] === undefined || row[key][subKey] === null) {
          row[key][subKey] = subValue;
          updated = true;
        } else if (isObject(row[key][subKey]) && isObject(subValue)) {
          for (const [deepKey, deepValue] of Object.entries(subValue)) {
            if (row[key][subKey][deepKey] === undefined || row[key][subKey][deepKey] === null) {
              row[key][subKey][deepKey] = deepValue;
              updated = true;
            }
          }
        }
      }
    }
  }
  return updated;
}

// Discord allows one full member fetch per guild roughly every 30s, so preview and confirm share one.
const MEMBER_SNAPSHOT_TTL_MS = 120000;
let memberSnapshot = null;

async function fetchMembersOnce(guild, now) {
  if (memberSnapshot?.guildId === guild.id && now - memberSnapshot.at < MEMBER_SNAPSHOT_TTL_MS) return memberSnapshot.members;
  const members = await guild.members.fetch();
  memberSnapshot = { guildId: guild.id, at: now, members };
  return members;
}

async function buildCleanupPlan(client, now) {
  const guild = client.guilds.cache.get(GUILD_ID);
  const members = await fetchMembersOnce(guild, now);
  const memberIds = new Set(members.keys());
  const botIds = new Set(members.filter(m => m.user.bot).map(m => m.id));
  return planCleanup(await db.all(), { memberIds, botIds, now, inactiveDays: CLEANUP_INACTIVE_DAYS, activeDays: INTEREST_ACTIVE_WINDOW_DAYS });
}

module.exports = {
  db,
  applyCommandStatsResets,
  getDefaultDB: async function(user) {
    return await getDefaultDB(user);
  },
  initDB: async function(client) {
    const guild = client.guilds.cache.get(GUILD_ID);

    const users = guild.members.cache.map(member => {
      return {
        id: member.id,
        username: member.user.username,
        discriminator: member.user.discriminator,
        avatar: member.user.avatar,
        roles: member.roles.cache.map(role => role.id),
        joinedAt: member.joinedAt,
        createdAt: member.user.createdAt,
      };
    });

    logger.log("Loading database...");
    logger.log(`Found ${users.length} users.`);
    let updatedUsers = 0;
    for (const user of users) {
      if (user.id === client.user.id) continue;
      const dbUser = await db.get(user.id);
      if (!isPlayerRow(dbUser)) continue;
      // Legacy schema stored stats.commands.total as the number 0.
      const repaired = dbUser.stats?.commands && typeof dbUser.stats.commands.total === "number";
      if (repaired) dbUser.stats.commands.total = {};
      if (mergeDefaults(dbUser, await getDefaultDB(user)) || repaired) {
        await db.set(user.id, dbUser);
        logger.log(`Updated ${user.username} [${user.id}] in the database.`);
        updatedUsers++;
      }
    }
    logger.log(`Database loaded. ${updatedUsers?updatedUsers:"No"} users updated.`);
  },
  addNewDBUser: async function(user) {
    const dbUser = await db.get(user.id);
    if (isPlayerRow(dbUser)) return false;
    const defaultDB = await getDefaultDB(user);
    if (dbUser) mergeDefaults(dbUser, defaultDB);
    await db.set(user.id, dbUser || defaultDB);
    logger.log(`Added ${user.username} [${user.id}] to the database.`);
    return true;
  },
  getPlayerRow: async function(userId) {
    const row = await db.get(userId);
    return isPlayerRow(row) ? row : null;
  },
  deleteDBUser: async function(user) {
    const dbUser = await db.get(user.id);
    if (dbUser) {
      await db.delete(user.id);
    }
    logger.log(`Deleted ${user.username} [${user.id}] from the database.`);
  },
  deleteDBValue: async function(user, value) {
    const dbUser = await db.get(user.id);
    if (dbUser) {
      delete dbUser[value];
      await db.set(user.id, dbUser);
    }
    logger.log(`Deleted ${value} for ${user.username} [${user.id}] from the database.`);
  },
  resetDBUser: async function(user) {
    const dbUser = await db.get(user.id);
    const defaultDB = await getDefaultDB(user);
    if (dbUser) {
      await db.set(user.id, defaultDB);
    }
    logger.log(`Reset ${user.username} [${user.id}] in the database.`);
  },
  resetDBValue: async function(user, value) {
    const dbUser = await db.get(user.id);
    const defaultDB = await getDefaultDB(user);
    if (dbUser) {
      dbUser[value] = defaultDB[value];
      await db.set(user.id, dbUser);
    }
    logger.log(`Reset ${value} for ${user.username} [${user.id}] in the database.`);
  },
  setDBValue: async function(user, value, newValue) {
    const type = typeof newValue;
    if (type === "string") {
      if (!isNaN(newValue)) {
        newValue = Number(newValue);
      }
    } else if (type === "object") {
      if (Array.isArray(newValue)) {
        newValue = newValue;
      }
    }
    await db.set(`${user.id}.${value}`, newValue);
    logger.log(`Set ${value} for ${user.username}} [${user.id}] in the database.`);
  },
  previewCleanup: async function(client) {
    return await buildCleanupPlan(client, Date.now());
  },
  runCleanup: async function(client) {
    const now = Date.now();
    const plan = await buildCleanupPlan(client, now);
    const departed = [];
    const inactive = [];

    // The member snapshot can be up to two minutes old; the live cache catches anyone who rejoined since.
    const liveMembers = client.guilds.cache.get(GUILD_ID)?.members?.cache;
    for (const entry of plan.departed) {
      if (liveMembers?.has(entry.id)) continue;
      const amount = await withUserLock(entry.id, async () => {
        const row = await db.get(entry.id);
        await db.delete(entry.id);
        return isPlayerRow(row) ? holdings(row) : 0;
      });
      departed.push({ ...entry, amount });
    }

    for (const entry of plan.inactive) {
      const amount = await withUserLock(entry.id, async () => {
        const row = await db.get(entry.id);
        if (!isPlayerRow(row) || !isLongInactive(row, now, CLEANUP_INACTIVE_DAYS)) return 0;
        const balance = Number(row.balance) || 0;
        const bank = Number(row.bank) || 0;
        await db.set(`${entry.id}.balance`, Math.min(0, balance));
        await db.set(`${entry.id}.bank`, Math.min(0, bank));
        return holdings(row);
      });
      if (amount > 0) inactive.push({ ...entry, amount });
    }

    const total = [...departed, ...inactive].reduce((sum, e) => sum + e.amount, 0);
    const { jackpot, perRecipient } = splitPot(total, plan.recipients.length, CLEANUP_JACKPOT_SHARE);
    if (jackpot > 0) await addToJackpot(jackpot);
    if (perRecipient > 0) {
      for (const id of plan.recipients) {
        await withUserLock(id, () => db.add(`${id}.bank`, perRecipient));
      }
    }

    logger.log(`Cleanup: deleted ${departed.length} departed, emptied ${inactive.length} inactive, collected ${total.toLocaleString("en-US")}. Jackpot +${jackpot.toLocaleString("en-US")}, ${plan.recipients.length} players +${perRecipient.toLocaleString("en-US")} each.`);
    return { departed, inactive, recipients: plan.recipients, total, jackpot, perRecipient };
  },
};