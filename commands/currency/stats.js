const {slashCommandBuilder, SlashCommandBuilder} = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: "./db/users.sqlite" });
const { addNewDBUser } = require("../../database");
const { CURRENCY_NAME } = require("../../config.json");
const logger = require("../../utils/logger");

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
            logger.warn(`No database entry for user ${user.username} (${user.id}), creating one...`)
            await addNewDBUser(user);
        }
        const stats = await db.get(user.id);
        await interaction.reply({content: "```json\n" + JSON.stringify(stats, null, 4) + "```", ephemeral: true});
    },
};