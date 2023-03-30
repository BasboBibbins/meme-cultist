const {SlashCommandBuilder, EmbedBuilder} = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const { addNewDBUser } = require("../../database");
const { CURRENCY_NAME } = require("../../config.json");
const logger = require("../../utils/logger");
const { randomHexColor } = require('../../utils/randomcolor');

module.exports = {
    data: new SlashCommandBuilder()
        .setName("announce")
        .setDescription(`Announce something to the server.`)
        .addStringOption(option =>
            option.setName('message')
                .setDescription('The message to send.')
                .setRequired(true)),
    async execute(interaction) {
        const message = interaction.options.getString('message');
        const embed = new EmbedBuilder()
            .setAuthor({ name: `${interaction.user.username} has an annoucement to make!`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
            .setColor(randomHexColor())
            .setDescription(message)
            .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();
        const announcementChannel = interaction.guild.channels.cache.find(channel => channel.name === "is-of-happenings");
        if (!announcementChannel) {
            logger.warn(`No announcement channel found for server ${interaction.guild.name} (${interaction.guild.id}).`, "warn");
            return await interaction.reply({content: `No announcement channel found for server ${interaction.guild.name} (${interaction.guild.id}).`, ephemeral: true});
        }
        await announcementChannel.send({embeds: [embed], content: `@everyone`, allowedMentions: { parse: ['everyone'] }});
        await interaction.reply({content: `Announcement sent to #${announcementChannel.name}!`, ephemeral: true});
    }
}