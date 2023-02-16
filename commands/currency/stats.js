const {SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: "./db/users.sqlite" });
const { addNewDBUser } = require("../../database");
const { CURRENCY_NAME } = require("../../config.json");
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
    async execute(interaction) {
        const user = interaction.options.getUser('user') || interaction.user;
        const dbUser = await db.get(user.id);
        if (!dbUser) {
            logger.warn(`No database entry for user ${user.username} (${user.id}), creating one...`)
            await addNewDBUser(user);
        }
        const fetchedUser = await user.fetch()
        let accentColor = fetchedUser.hexAccentColor ? fetchedUser.hexAccentColor : randomHexColor();

        const stats = await db.get(user.id);
        // make an embed for each stat category. page 1 is general, page 2 is currency, page 3 is social, page 4 is misc
        const embed = new EmbedBuilder()
            .setAuthor({ name: `Requested by ${interaction.user.username}#${interaction.user.discriminator}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
            .setTitle(`${user.username}'s Stats`)
            .setDescription(`Page 1 of 4`)
            .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 512 }))
            .setColor(`${accentColor}`)
            .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true})})
            .setTimestamp();
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('previous')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('next')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Primary),
            );
        
        embed.addFields(
            { name: "General", value: `**Username:** ${user.username}#${user.discriminator}`, inline: false },
            { name: "Creation Date", value: `${new Date(user.createdTimestamp).toLocaleString()}`, inline: false },
            { name: "Join Date", value: `${new Date(interaction.guild.members.cache.get(user.id).joinedTimestamp).toLocaleString()}`, inline: false },
        )
        await interaction.reply({embeds: [embed], components: [row]});
        await interaction.followUp({content: `\`\`\`json\n${JSON.stringify(stats, null, 4)}\`\`\``, ephemeral: true});
    },
};