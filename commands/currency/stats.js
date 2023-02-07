const {slashCommandBuilder, SlashCommandBuilder} = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: "./db/users.sqlite" });

const { addNewDBUser } = require("../../database");

const { CURRENCY_NAME } = require("../../config.json");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("stats")
        .setDescription("Check a users stats on the server.")
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to check the stats of.')
                .setRequired(false)),
    async execute(interaction) {
        const user = interaction.options.getUser('user') || interaction.user;
        const dbUser = await db.get(user.id);
        if (!dbUser) {
            console.log(`\x1b[33m[WARN]\x1b[0m No database entry for user ${user.username} (${user.id}), creating one...`)
            await addNewDBUser(user);
        }
        const stats = await db.get(user.id);
        await interaction.reply({content: "```json\n" + JSON.stringify(stats, null, 4) + "```", ephemeral: true});
    },
};