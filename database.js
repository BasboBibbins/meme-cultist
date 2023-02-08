const { QuickDB } = require("quick.db");
const { GUILD_ID } = require("./config.json");

const db = new QuickDB({ filePath: "./db/users.sqlite" });

async function getDefaultDB(user) {
    return {
        "id": user.id,
        "name": user.username+"#"+user.discriminator,
        "balance": 100,
        "bank": 0,
        "inventory": [],
        "cooldowns": {
            "daily": 0,
            "weekly": 0,
        },
        "stats": {
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
            "largestBalance": 0
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

        console.log(`\x1b[32m[DB]\x1b[0m Loading database...`)
        console.log(`\x1b[32m[DB]\x1b[0m Found ${users.length} users.`)
        let newUsers = 0;
        let updatedUsers = 0;
        for (const user of users) {
            const dbUser = await db.get(user.id);
            const defaultDB = await getDefaultDB(user);
            if (!dbUser) {
                newUsers++;
                await db.set(user.id, defaultDB);
                console.log(`\x1b[32m[DB]\x1b[0m Adding ${user.username}#${user.discriminator} [${user.id}] to the database.`)
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
                    console.log(`\x1b[32m[DB]\x1b[0m Updated ${user.username}#${user.discriminator} [${user.id}] in the database.`)
                    updatedUsers++;
                }
            }
        }
        console.log(`\x1b[32m[DB]\x1b[0m Database loaded. ${newUsers?newUsers:"No"} new users in database. ${updatedUsers?updatedUsers:"No"} users updated.`)
    },
    addNewDBUser: async function(user) {
        const dbUser = await db.get(user.id);
        const defaultDB = await getDefaultDB(user);
        if (!dbUser) {
            await db.set(user.id, defaultDB);
        }
        console.log(`\x1b[32m[DB]\x1b[0m Added ${user.username}#${user.discriminator} [${user.id}] to the database.`)
    },
    deleteDBUser: async function(user) {
        const dbUser = await db.get(user.id);
        if (dbUser) {
            await db.delete(user.id);
        }
        console.log(`\x1b[32m[DB]\x1b[0m Deleted ${user.username}#${user.discriminator} [${user.id}] from the database.`)
    },
    deleteDBValue: async function(user, value) {
        const dbUser = await db.get(user.id);
        if (dbUser) {
            delete dbUser[value];
            await db.set(user.id, dbUser);
        }
        console.log(`\x1b[32m[DB]\x1b[0m Deleted ${value} for ${user.username}#${user.discriminator} [${user.id}] from the database.`)
    },
    resetDBUser: async function(user) {
        const dbUser = await db.get(user.id);
        const defaultDB = await getDefaultDB(user);
        if (dbUser) {
            await db.set(user.id, defaultDB);
        }
        console.log(`\x1b[32m[DB]\x1b[0m Reset ${user.username}#${user.discriminator} [${user.id}] in the database.`)
    },
    resetDBValue: async function(user, value) {
        const dbUser = await db.get(user.id);
        const defaultDB = await getDefaultDB(user);
        if (dbUser) {
            dbUser[value] = defaultDB[value];
            await db.set(user.id, dbUser);
        }
        console.log(`\x1b[32m[DB]\x1b[0m Reset ${value} for ${user.username}#${user.discriminator} [${user.id}] in the database.`)
    },
    setDBValue: async function(user, value, newValue) {
        const dbUser = await db.get(user.id);
        if (dbUser) {
            dbUser[value] = newValue;
            await db.set(user.id, dbUser);
        }
        console.log(`\x1b[32m[DB]\x1b[0m Set ${value} for ${user.username}#${user.discriminator} [${user.id}] in the database.`)
    }
}