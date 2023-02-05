const { disableValidators } = require("discord.js");
const { QuickDB } = require("quick.db");

const db = new QuickDB({ filePath: "./db/users.sqlite" });

module.exports = {
    initDB: async function(client) {
        // get all users, and add them to the db if they don't exist
        const guild = client.guilds.cache.get(GUILD_ID);

        const users = guild.members.cache.map(member => {
            if (!member.user.bot) {
                return member.user.id;
            }
        });

        for (const user of users) {
            if (user) {
                const userExists = await db.get(user);
                if (!userExists) {
                    await db.set(user, {
                        "id": user,
                        "balance": 0,
                        "bank": 0,
                        "inventory": [],
                        "cooldowns": {
                            "beg": 0,
                            "daily": 0,
                            "weekly": 0,
                        },
                        "stats": {
                            "begs": 0,
                            "dailies": 0,
                            "weeklies": 0,
                        }
                    });
                }
                console.log(`Added ${user} to the database.`);
            }
        }
    },
}