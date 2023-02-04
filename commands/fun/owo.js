const {slashCommandBuilder, SlashCommandBuilder} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName("owo")
        .setDescription("OwO what's this?")
        .addStringOption(option =>
            option.setName('text')
                .setDescription('The text to OwO-fy.')
                .setRequired(true)),
    async execute(interaction) {
        var text = interaction.options.getString('text');
        text = text.replace(/[lr]/g, 'w');
        text = text.replace(/[LR]/g, 'W');
        text = text.replace(/n([aeiou])/g, 'ny$1');
        text = text.replace(/N([aeiou])/g, 'Ny$1');
        text = text.replace(/N([AEIOU])/g, 'NY$1');
        text = text.replace(/ove/g, 'uv');
        text = text.replace(/!+/g, ` ${Array.from({length: Math.floor(Math.random() * 5) + 1}, () => 'OwO').join(' ')} `);
        text = text.replace(/\?+/g, ` ${Array.from({length: Math.floor(Math.random() * 5) + 1}, () => 'OwO').join(' ')} `);
        await interaction.reply(text);
    },
};