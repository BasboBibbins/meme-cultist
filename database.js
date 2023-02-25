const { QuickDB } = require("quick.db");
const { GUILD_ID } = require("./config.json");
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const logger = require("./utils/logger");

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
        },
        "stats": {
            "commands": {
                "dailyReset": 0,
                "monthlyReset": 0,
                "yearlyReset": 0,
                "daily": {},
                "monthly": {},
                "yearly": {},
                "total": 0,
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
            },
            "slots": {
                "wins": 0,
                "losses": 0,
                "jackpots": 0,
                "biggestWin": 0,
                "biggestLoss": 0,
            },
            "flip": {
                "wins": 0,
                "losses": 0,
                "biggestWin": 0,
                "biggestLoss": 0,
            },
            "begs": {
                "wins": 0,
                "losses": 0,
            },
            "largestBalance": 0,
            "largestBank": 0,
        },
    }
}
module.exports = {
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
            const dbUser = await db.get(user.id);
            const defaultDB = await getDefaultDB(user);
            if (!dbUser) {
                newUsers++;
                await db.set(user.id, defaultDB);
                logger.log(`Adding ${user.username}#${user.discriminator} [${user.id}] to the database.`)
            } else {
                let updated = false;
                for (const [key, value] of Object.entries(defaultDB)) {
                    if (!dbUser[key]) {
                        dbUser[key] = value;
                        updated = true;
                    }
                }
                if (updated) {
                    await db.set(user.id, dbUser);
                    logger.log(`Updated ${user.username}#${user.discriminator} [${user.id}] in the database.`)
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
        logger.log(`Added ${user.username}#${user.discriminator} [${user.id}] to the database.`)
    },
    deleteDBUser: async function(user) {
        const dbUser = await db.get(user.id);
        if (dbUser) {
            await db.delete(user.id);
        }
        logger.log(`Deleted ${user.username}#${user.discriminator} [${user.id}] from the database.`)
    },
    deleteDBValue: async function(user, value) {
        const dbUser = await db.get(user.id);
        if (dbUser) {
            delete dbUser[value];
            await db.set(user.id, dbUser);
        }
        logger.log(`Deleted ${value} for ${user.username}#${user.discriminator} [${user.id}] from the database.`)
    },
    resetDBUser: async function(user) {
        const dbUser = await db.get(user.id);
        const defaultDB = await getDefaultDB(user);
        if (dbUser) {
            await db.set(user.id, defaultDB);
        }
        logger.log(`Reset ${user.username}#${user.discriminator} [${user.id}] in the database.`)
    },
    resetDBValue: async function(user, value) {
        const dbUser = await db.get(user.id);
        const defaultDB = await getDefaultDB(user);
        if (dbUser) {
            dbUser[value] = defaultDB[value];
            await db.set(user.id, dbUser);
        }
        logger.log(`Reset ${value} for ${user.username}#${user.discriminator} [${user.id}] in the database.`)
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
        logger.log(`Set ${value} for ${user.username}#${user.discriminator} [${user.id}] in the database.`)
    }
}