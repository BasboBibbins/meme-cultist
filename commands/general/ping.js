const { SlashCommandBuilder, EmbedBuilder } = require("discord.js")
const logger = require("../../utils/logger")
const { randomHexColor } = require("../../utils/randomcolor")

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Pong!"),
    async execute(interaction) {
        const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
        const embed = new EmbedBuilder()
            .setAuthor({ name: `Pong! 🏓`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
            .setDescription(`Latency is ${sent.createdTimestamp - interaction.createdTimestamp}ms.\n\nAPI Latency is ${Math.round(interaction.client.ws.ping)}ms.`)
            .setColor(randomHexColor())
            .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp()
        await interaction.editReply({ content: null, embeds: [embed] });
    }
}