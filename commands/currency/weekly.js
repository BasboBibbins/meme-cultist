const { SlashCommandBuilder } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: "./db/users.sqlite" });

const { addNewDBUser } = require("../../database");

const { CURRENCY_NAME } = require("../../config.json");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("weekly")
        .setDescription(`Claim your weekly ${CURRENCY_NAME}.`),
    async execute(interaction) {
        const user = interaction.user;
        const dbUser = await db.get(user.id);
        if (!dbUser) {
            console.log(`\x1b[33m[WARN]\x1b[0m No database entry for user ${user.username} (${user.id}), creating one...`)
            await addNewDBUser(user.id);
        }
        const cooldown = 10000; // 6.048e+8
        if (dbUser.cooldowns.weekly > Date.now()) {
            const timeLeft = new Date(dbUser.cooldowns.weekly - Date.now());
            const oneDay = 8.64e+7;
            const daysLeft = Math.floor(timeLeft / oneDay);
            return interaction.reply({content: `You have already claimed your weekly ${CURRENCY_NAME}, please wait **${daysLeft > 0?daysLeft:0}d ${timeLeft.getUTCHours()}h ${timeLeft.getUTCMinutes()}m ${timeLeft.getUTCSeconds()}s** before claiming again.`, ephemeral: true});
        }

        const amount = Math.floor(Math.random() * 4000) + 1001; // guaranteed to be at least 5000
        dbUser.balance += amount;
        dbUser.cooldowns.weekly = Date.now() + cooldown;
        await db.set(user.id, dbUser);
        await interaction.reply({content: `You have claimed your weekly ${CURRENCY_NAME} and received **${amount}** ${CURRENCY_NAME}!`});
    },
};