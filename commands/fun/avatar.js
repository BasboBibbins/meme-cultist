const {slashCommandBuilder, SlashCommandBuilder} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName("avatar")
        .setDescription("Steal someone's profile picture!")
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to steal the avatar from.')
                .setRequired(false)
        ),
    async execute(interaction) {
        const user = interaction.options.getUser('user') || interaction.user;
        const avatar = user.displayAvatarURL({dynamic: true, size: 4096});
        if (Buffer.byteLength(avatar) > 8e+6) return interaction.reply({content: "The avatar is too big to send! (8MB maximum)", ephemeral: true});
        await interaction.reply({files: [avatar]});
    },
};