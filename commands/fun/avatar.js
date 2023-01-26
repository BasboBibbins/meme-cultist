const {slashCommandBuilder, SlashCommandBuilder} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName("avatar")
        .setDescription("Steal someone's profile picture!")
        .addStringOption(option =>
            option.setName('question')
                .setDescription('The question to ask the bot.')
                .setRequired(false)),
    async execute(interaction) {
        try {
            
        } catch(e) {
            interaction.reply('**An error occured:**\n```javascript\n'+e+'\n```');
            console.log(e)            
        }
    },
};