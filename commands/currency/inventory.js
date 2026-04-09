const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('inventory')
        .setDescription('View and manage your owned items.')
        .addSubcommand(sub =>
            sub.setName('view')
                .setDescription('Show all owned items across categories.'))
        .addSubcommand(sub =>
            sub.setName('equip')
                .setDescription('Equip an owned item.')
                .addStringOption(opt =>
                    opt.setName('item')
                        .setDescription('The item to equip.')
                        .setRequired(true))),

    async execute(interaction) {
        const footer = {
            text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`,
            iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }),
        };

        const embed = new EmbedBuilder()
            .setTitle('Inventory - Coming Soon')
            .setDescription(
                'The inventory system is under construction!\n\n'
                + '**Planned features:**\n'
                + '`/inventory view` — See all your owned items\n'
                + '`/inventory equip <item>` — Equip themes, card backs, and more\n\n'
                + 'Use `/theme owned` to see your themes in the meantime.'
            )
            .setColor(0xFFAA00)
            .setFooter(footer)
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
