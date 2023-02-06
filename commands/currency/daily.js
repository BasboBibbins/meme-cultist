const { SlashCommandBuilder } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: "./db/users.sqlite" });

const { addNewDBUser } = require("../../database");

const { CURRENCY_NAME } = require("../../config.json");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("daily")
        .setDescription(`Claim your daily ${CURRENCY_NAME}.`),
    async execute(interaction) {
        const user = interaction.user;
        const dbUser = await db.get(user.id);
        if (!dbUser) {
            console.log(`\x1b[33m[WARN]\x1b[0m No database entry for user ${user.username} (${user.id}), creating one...`)
            await addNewDBUser(user.id);
        }
        const dailyCooldown = 8.64e+7;
        if (dbUser.dailyCooldown > Date.now()) {
            const timeLeft = new Date(dbUser.dailyCooldown - Date.now());
            return interaction.reply({content: `You have already claimed your daily ${CURRENCY_NAME}, please wait **${timeLeft.getUTCHours()}h ${timeLeft.getUTCMinutes()}m ${timeLeft.getUTCSeconds()}s** before claiming again.`, ephemeral: true});
        }
        const amount = Math.floor(Math.random() * 1000) + 1;
        dbUser.balance += amount;
        dbUser.dailyCooldown = Date.now() + dailyCooldown;
        await db.set(user.id, dbUser);
        await interaction.reply({content: `You have claimed your daily ${CURRENCY_NAME} and received **${amount}** ${CURRENCY_NAME}!`});
    },
};