const {slashCommandBuilder, SlashCommandBuilder} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ayy")
        .setDescription("lmao!"),
    async execute(interaction) {
        await interaction.reply('lmao! :alien:');
    },
};