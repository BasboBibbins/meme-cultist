const { QuickDB } = require("quick.db");
const { GUILD_ID } = require("./config.json");

const db = new QuickDB({ filePath: "./db/users.sqlite" });

module.exports = {
    defaultDB : {
        "id": user.id,
        "name": user.username+"#"+user.discriminator,
        "balance": 0,
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
                "currentStreak": 0,
                "longestStreak": 0,
            },
            "blackjack": {
                "wins": 0,
                "losses": 0,
                "ties": 0,
                "biggestWin": 0,
                "biggestLoss": 0,
            },
            "slots": {
                "wins": 0,
                "losses": 0,
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
            "largestWin": 0,
            "largestLoss": 0
        },
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
        for (const user of users) {
            const dbUser = await db.get(user.id);
            if (!dbUser) {
                newUsers++;
                await db.set(user.id, this.defaultDB);
                console.log(`\x1b[32m[DB]\x1b[0m Adding ${user.username}#${user.discriminator} [${user.id}] to the database.`)
            }
        }
        console.log(`\x1b[32m[DB]\x1b[0m Database loaded. ${newUsers?newUsers:"No"} new users in database.`)
    },
    addNewDBUser: async function(user) {
        const dbUser = await db.get(user.id);
        if (!dbUser) {
            await db.set(user.id, this.defaultDB);
        }
        console.log(`\x1b[32m[DB]\x1b[0m Added ${user.username}#${user.discriminator} [${user.id}] to the database.`)
    }

}