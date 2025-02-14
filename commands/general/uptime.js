const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { randomHexColor } = require('../../utils/randomcolor');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('uptime')
        .setDescription('Check the uptime of the bot.'),
    async execute(interaction) {
        const uptime = interaction.client.uptime;
        const days = Math.floor(uptime / 86400000);
        const hours = Math.floor(uptime / 3600000) % 24;
        const minutes = Math.floor(uptime / 60000) % 60;
        const seconds = Math.floor(uptime / 1000) % 60;

        const user = interaction.user;
        const embed = new EmbedBuilder()
            .setAuthor({ name: `${user.displayName }`, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setColor(randomHexColor())
            .addFields(
                { name: "Uptime", value: `${days} days, ${hours} hours, ${minutes} minutes, ${seconds} seconds`, inline: true },
            )
            .setTimestamp()
            .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true}) });
        await interaction.reply({embeds: [embed]});
    }
};