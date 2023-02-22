const {SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: "./db/users.sqlite" });
const { addNewDBUser } = require("../../database");
const logger = require("../../utils/logger");
const { randomHexColor } = require("../../utils/randomcolor");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("stats")
        .setDescription("Check a users stats on the server.")
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to check the stats of.')
                .setRequired(false)),
    async execute(interaction, page = 1) {
        let msg = null;
        if (msg === null) {
            msg = await interaction.defer
        }
        const user = interaction.options.getUser('user') || interaction.user;
        const dbUser = await db.get(user.id);
        if (!dbUser) {
            logger.warn(`No database entry for user ${user.username} (${user.id}), creating one...`)
            await addNewDBUser(user);
        }
        const fetchedUser = await user.fetch()
        let accentColor = fetchedUser.hexAccentColor ? fetchedUser.hexAccentColor : randomHexColor();

        const stats = await db.get(user.id);
        const embed = new EmbedBuilder()
            .setAuthor({ name: `Requested by ${interaction.user.username}#${interaction.user.discriminator}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
            .setTitle(`${user.username}'s Stats`)
            .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 512 }))
            .setColor(`${accentColor}`);
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('previous')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId('next')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Primary),
            );
        switch (page) {
            case 1:
                embed.setFields(
                    { name: "General", value: `**Username:** ${user.username}#${user.discriminator}\n`, inline: false },
                    { name: "Creation Date", value: `${new Date(user.createdTimestamp).toLocaleString()}`, inline: true },
                    { name: "Join Date", value: `${new Date(interaction.guild.members.cache.get(user.id).joinedTimestamp).toLocaleString()}`, inline: true },
                );
                embed.setFooter({ text: `Page 1/4`, iconURL: interaction.guild.iconURL({ dynamic: true }) });
                break;
            case 2:
                embed.setFooter({ text: `Page 2/4`, iconURL: interaction.guild.iconURL({ dynamic: true }) });
                break;
            case 3:
                embed.setFooter({ text: `Page 3/4`, iconURL: interaction.guild.iconURL({ dynamic: true }) });
                break;
            case 4:
                embed.setFooter({ text: `Page 4/4`, iconURL: interaction.guild.iconURL({ dynamic: true }) });
                break;
        }
        msg = await interaction.editReply({embeds: [embed], components: [row]});
        const filter = i => i.customId === 'previous' || i.customId === 'next';
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 15000 });

        collector.on('collect', async i => {
            if (i.customId === 'previous') {
                page--;
                if (page === 1) {
                    i.message.components[0].components[0].setDisabled(true);
                }
                logger.debug(`Page: ${page}`);
                return await module.exports.execute(interaction, page);
            } else if (i.customId === 'next') {
                page++;
                if (page === 4) {
                    i.message.components[0].components[1].setDisabled(true);
                }
                logger.debug(`Page: ${page}`);
                return await module.exports.execute(interaction, page);
            }
            await i.deferUpdate();
        });
    },
};