const {slashCommandBuilder, SlashCommandBuilder} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName("darkmaga")
        .setDescription("CRVVTV DVRK MVGV TVXT -Q")
        .addStringOption(option =>
            option.setName('text')
                .setDescription('The text to have dark maga-fied.')
                .setRequired(true)),
    async execute(interaction) {
        var text = interaction.options.getString('text');
        text = text.toUpperCase();
        text = text.replace(/[AEIU]/g, 'V');
        text = text.replace(/O/g, 'Q');
        text += '\n\n -Q';
        await interaction.reply(text);
    },
};