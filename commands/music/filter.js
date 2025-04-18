const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { randomHexColor } = require('../../utils/randomcolor');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('filter')
        .setDescription('Add a filter to the music')
        .addStringOption(option =>
            option.setName('filter')
                .setDescription('The filter to toggle.')
                .setRequired(true)
                .setAutocomplete(true)),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused();
        let filters = [
            '8d',
            'bassboost',
            'chorus',
            'compressor',
            'dim',
            'earrape',
            'expander',
            'fadein',
            'flanger',
            'gate',
            'haas',
            'karaoke',
            'mcompand',
            'mono',
            'mstlr',
            'mstrr',
            'nightcore',
            'normalizer',
            'phaser',
            'pulsator',
            'reverse',
            'softlimiter',
            'subboost',
            'surrounding',
            'treble',
            'tremolo',
            'vaporwave',
            'vibrato',
            'clear'
        ];
        const filtered = filters.filter(filter => filter.toLowerCase().startsWith(focusedValue.toLowerCase())).slice(0, 25);
        await interaction.respond(
            filtered.map(filter => ({ name: filter, value: filter }))
        );
    },
    async execute(interaction) {
        const filter = interaction.options.getString('filter');
        const queue = interaction.client.player.nodes.get(interaction.guild.id);

        const embed = new EmbedBuilder()
            .setAuthor({ name: interaction.user.displayName , iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
            .setColor(randomHexColor())
            .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        if (!queue) {
            embed.setDescription('There is no music playing!');
        } else {
            if (filter === 'clear') {
                let enabled = queue.filters.ffmpeg.getFiltersEnabled();
                for (let i = 0; i < enabled.length; i++) {
                    await queue.filters.ffmpeg.toggle([enabled[i]]);
                }
                embed.setDescription('🎶 All filters have been cleared');
            } else {
                await queue.filters.ffmpeg.toggle([filter]); // TODO: fix bot skipping song when filter is enabled
                embed.setDescription(`🎶 The **${filter}** filter has been ${queue.filters.ffmpeg.isEnabled(filter) ? 'enabled' : 'disabled'}`);
            }
        }
        return await interaction.reply({ embeds: [embed] });
    } 
}