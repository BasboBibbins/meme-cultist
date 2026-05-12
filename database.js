const { QuickDB } = require("quick.db");
const moment = require("moment");
const { GUILD_ID } = require("./config.js");
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const logger = require("./utils/logger");

// Read the user's stats.commands subtree, clear any buckets whose period has
// rolled over, and persist if anything changed. Returns the in-memory object so
// callers can mutate further (e.g. increment a counter) and write once.
// Idempotent — safe to call from /stats, the post-command handler, or a startup sweep.
async function applyCommandStatsResets(userId) {
    const commands = (await db.get(`${userId}.stats.commands`)) || {};

    const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
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
            "largestBalance": 0,
            "largestBank": 0,
        },
        "profile": {
            "theme": {
                "equipped": "classic",
                "owned": [],
            },
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
    }
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
            }
        });

        logger.log(`Loading database...`)
        logger.log(`Found ${users.length} users.`)
        let newUsers = 0;
        let updatedUsers = 0;
        for (const user of users) {
            if (user.id === client.user.id) continue;
            const dbUser = await db.get(user.id);
            const defaultDB = await getDefaultDB(user);
            if (!dbUser) {
                newUsers++;
                await db.set(user.id, defaultDB);
                logger.log(`Adding ${user.username} [${user.id}] to the database.`)
            } else {
                let updated = false;
                // Type-repair migration: legacy schema stored stats.commands.total
                // as the number 0; convert to {} so per-command counters work.
                if (dbUser.stats && dbUser.stats.commands && typeof dbUser.stats.commands.total === 'number') {
                    dbUser.stats.commands.total = {};
                    updated = true;
                }
                for (const [key, value] of Object.entries(defaultDB)) {
                    if (!dbUser[key]) {
                        dbUser[key] = value;
                        updated = true;
                    } else if (dbUser[key] && typeof dbUser[key] === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
                        // Deep-merge nested objects (e.g. cooldowns, profile, stats) so new
                        // fields like cooldowns.freespins and profile.theme.equipped are added
                        // to existing users without wiping their current data.
                        for (const [subKey, subValue] of Object.entries(value)) {
                            if (dbUser[key][subKey] === undefined || dbUser[key][subKey] === null) {
                                dbUser[key][subKey] = subValue;
                                updated = true;
                            } else if (dbUser[key][subKey] && typeof dbUser[key][subKey] === 'object' && subValue && typeof subValue === 'object' && !Array.isArray(subValue)) {
                                for (const [deepKey, deepValue] of Object.entries(subValue)) {
                                    if (dbUser[key][subKey][deepKey] === undefined || dbUser[key][subKey][deepKey] === null) {
                                        dbUser[key][subKey][deepKey] = deepValue;
                                        updated = true;
                                    }
                                }
                            }
                        }
                    }
                }
                if (updated) {
                    await db.set(user.id, dbUser);
                    logger.log(`Updated ${user.username} [${user.id}] in the database.`)
                    updatedUsers++;
                }
            }
        }
        logger.log(`Database loaded. ${newUsers?newUsers:"No"} new users in database. ${updatedUsers?updatedUsers:"No"} users updated.`)
    },
    addNewDBUser: async function(user) {
        const dbUser = await db.get(user.id);
        const defaultDB = await getDefaultDB(user);
        if (!dbUser) {
            await db.set(user.id, defaultDB);
        }
        logger.log(`Added ${user.username} [${user.id}] to the database.`)
    },
    deleteDBUser: async function(user) {
        const dbUser = await db.get(user.id);
        if (dbUser) {
            await db.delete(user.id);
        }
        logger.log(`Deleted ${user.username} [${user.id}] from the database.`)
    },
    deleteDBValue: async function(user, value) {
        const dbUser = await db.get(user.id);
        if (dbUser) {
            delete dbUser[value];
            await db.set(user.id, dbUser);
        }
        logger.log(`Deleted ${value} for ${user.username} [${user.id}] from the database.`)
    },
    resetDBUser: async function(user) {
        const dbUser = await db.get(user.id);
        const defaultDB = await getDefaultDB(user);
        if (dbUser) {
            await db.set(user.id, defaultDB);
        }
        logger.log(`Reset ${user.username} [${user.id}] in the database.`)
    },
    resetDBValue: async function(user, value) {
        const dbUser = await db.get(user.id);
        const defaultDB = await getDefaultDB(user);
        if (dbUser) {
            dbUser[value] = defaultDB[value];
            await db.set(user.id, dbUser);
        }
        logger.log(`Reset ${value} for ${user.username} [${user.id}] in the database.`)
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
        logger.log(`Set ${value} for ${user.username}} [${user.id}] in the database.`)
    },
    cleanDB: async function(client) {
        const guild = client.guilds.cache.get(GUILD_ID);
        const users = guild.members.cache.map(member => {
            return {
                id: member.id,
                username: member.user.username,
            }
        });
        const dbUsers = await db.all();
        let deletedUsers = []
        for (const dbUser of dbUsers) {
            const user = users.find(user => user.id === dbUser.id);
            if (!user) {
                await db.delete(dbUser.id);
                deletedUsers.push(dbUser.value);
            }
        }
        if (deletedUsers.length === 0) {
            logger.log(`No users to delete.`)
            return [];
        }
        logger.log(`Cleaned the database. Deleted ${deletedUsers.length} users.`)
        return deletedUsers;
    },
}