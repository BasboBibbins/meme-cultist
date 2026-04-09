const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getThemeList } = require('../../themes/configs');
const { grantTheme } = require('../../themes/manager');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unlockall')
        .setDescription('Unlock all themes for a user (Admins only).')
        .addUserOption(opt =>
            opt.setName('target')
                .setDescription('The user to unlock all themes for.')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('target');
        const admin = interaction.user;

        const footer = {
            text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`,
            iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }),
        };

        try {
            const allThemes = getThemeList();
            const themeIds = allThemes.map(t => t.id);

            for (const themeId of themeIds) {
                await grantTheme(targetUser.id, themeId);
            }

            const embed = new EmbedBuilder()
                .setAuthor({ name: `Unlock All Themes`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                .setDescription(`Successfully unlocked all ${themeIds.length} themes for **${targetUser.username}**!`)
                .setColor(0x00FF00)
                .setFooter(footer)
                .setTimestamp();

            // Log the action to prevent abuse
            logger.info(`Admin ${admin.tag} (${admin.id}) used /unlockall on ${targetUser.tag} (${targetUser.id})`);

            return interaction.reply({ embeds: [embed] });
        } catch (error) {
            logger.error(`Error executing /unlockall: ${error}`);

            const errorEmbed = new EmbedBuilder()
                .setDescription(`An error occurred while unlocking themes for ${targetUser.username}.`)
                .setColor(0xFF0000)
                .setFooter(footer)
                .setTimestamp();

            return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
    },
};
