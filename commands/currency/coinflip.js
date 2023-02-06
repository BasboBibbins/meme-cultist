const {slashCommandBuilder, SlashCommandBuilder} = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: "./db/users.sqlite" });

const { addNewDBUser } = require("../../database");

const { CURRENCY_NAME } = require("../../config.json");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("flip")
        .setDescription(`Flip a coin and win or lose ${CURRENCY_NAME}.`)
        .addStringOption(option =>
            option.setName('bet')
                .setDescription('The amount of Koku to bet.')
                .setRequired(true)),
    async execute(interaction) {
        const bet = interaction.options.getString('bet');
        const dbUser = await db.get(interaction.user.id);
        if (!dbUser) {
            console.log(`\x1b[33m[WARN]\x1b[0m No database entry for user ${interaction.user.username} (${interaction.user.id}), creating one...`)
            await addNewDBUser(interaction.user.id);
        }
        if (bet > dbUser.balance) {
            await interaction.reply(`You don't have enough ${CURRENCY_NAME}!`);
            return;
        }
        if (bet < 1) {
            await interaction.reply(`You must flip at least 1 ${CURRENCY_NAME}!`);
            return;
        }
        if (bet == "all") {
            bet = dbUser.balance;
        }

        const chance = Math.floor(Math.random() * 100) + 1;


        if (chance > 50) {
            await interaction.reply(`Congratulation, you won! Here's **${bet}** ${CURRENCY_NAME}!`);
            await db.add(`${interaction.user.id}.balance`, bet);
        } else {
            await interaction.reply(`You lose! I'll be taking **${bet}** ${CURRENCY_NAME}!`);
            await db.subtract(`${interaction.user.id}.balance`, bet);
        }
    }, 
};