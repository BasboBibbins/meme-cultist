const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getAllItems, grantItem } = require('../../utils/inventory');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unlockall')
        .setDescription('Unlock all purchasable items for a user (Admins only).')
        .addUserOption(opt =>
            opt.setName('target')
                .setDescription('The user to unlock all items for.')
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
            const items = getAllItems().filter(i => i.weight > 0);

            for (const item of items) {
                await grantItem(targetUser.id, item.id);
            }

            const embed = new EmbedBuilder()
                .setAuthor({ name: `Unlock All Items`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                .setDescription(`Successfully unlocked all ${items.length} items for **${targetUser.username}**!`)
                .setColor(0x00FF00)
                .setFooter(footer)
                .setTimestamp();

            // Log the action to prevent abuse
            logger.info(`Admin ${admin.tag} (${admin.id}) used /unlockall on ${targetUser.tag} (${targetUser.id})`);

            return interaction.reply({ embeds: [embed] });
        } catch (error) {
            logger.error(`Error executing /unlockall: ${error}`);

            const errorEmbed = new EmbedBuilder()
                .setDescription(`An error occurred while unlocking items for ${targetUser.username}.`)
                .setColor(0xFF0000)
                .setFooter(footer)
                .setTimestamp();

            return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
    },
};
