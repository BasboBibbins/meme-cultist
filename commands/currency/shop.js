const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Browse and purchase items.')
        .addSubcommand(sub =>
            sub.setName('browse')
                .setDescription('List purchasable items grouped by tier.'))
        .addSubcommand(sub =>
            sub.setName('buy')
                .setDescription('Purchase a theme or item.')
                .addStringOption(opt =>
                    opt.setName('item')
                        .setDescription('The item to purchase.')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('preview')
                .setDescription('Preview an item before buying.')
                .addStringOption(opt =>
                    opt.setName('item')
                        .setDescription('The item to preview.')
                        .setRequired(true))),

    async execute(interaction) {
        const footer = {
            text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`,
            iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }),
        };

        const embed = new EmbedBuilder()
            .setTitle('Shop - Coming Soon')
            .setDescription(
                'The shop is under construction!\n\n'
                + '**Planned features:**\n'
                + '`/shop browse` — Browse items by category & tier\n'
                + '`/shop buy <item>` — Purchase themes and cosmetics\n'
                + '`/shop preview <item>` — Preview before you buy\n\n'
                + 'Use `/theme list` to see available themes in the meantime.'
            )
            .setColor(0xFFAA00)
            .setFooter(footer)
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
