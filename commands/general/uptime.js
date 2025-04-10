const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { randomHexColor } = require('../../utils/randomcolor');
const { formatTimeSince } = require('../../utils/time');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('uptime')
        .setDescription('Check the uptime of the bot.'),
    async execute(interaction) {
        const uptime = await formatTimeSince(interaction.client.uptime)
        const user = interaction.user;
        const embed = new EmbedBuilder()
            .setAuthor({ name: `${user.displayName }`, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setColor(randomHexColor())
            .addFields(
                { name: "Uptime", value: uptime, inline: true },
            )
            .setTimestamp()
            .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true}) });
        await interaction.reply({embeds: [embed]});
    }
};