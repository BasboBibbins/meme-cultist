const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { randomHexColor } = require('../../utils/randomcolor');
const logger = require('../../utils/logger');
const { Client: GeniusClient } = require('genius-lyrics');

// Initialize Genius API client
const genius = new GeniusClient(process.env.GENIUS_API_KEY); // Add your Genius API key to your .env file

function formatLyrics(lyrics) {
    const lines = lyrics.split('\n');
    const formattedLyrics = lines.map((line, index) => {
        if (index === 0 && line.trim() !== '') return;
        if (line.startsWith('[') && line.endsWith(']')) {
            return `**${line}**`;
        } else {
            return line;
        }
    }).join('\n');
    return formattedLyrics;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lyrics')
        .setDescription('Get the lyrics of the current song playing, or a song you specify.')
        .addStringOption(option =>
            option.setName('song')
                .setDescription('The song to get lyrics for.')
                .setRequired(false)),
    async execute(interaction) {
        await interaction.deferReply();
        const embed = new EmbedBuilder()
            .setColor(randomHexColor())
            .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();
        
        const player = interaction.client.player;
        const currentTrack = player.nodes.get(interaction.guild.id)?.currentTrack;
        let song = interaction.options.getString('song');

        // If no song is provided, try to use the current track
        if (!song) {
            if (currentTrack) {
                song = currentTrack.title.includes(' - ') 
                    ? `${currentTrack.title.split(' - ')[1]} ${currentTrack.title.split(' - ')[0]}` 
                    : `${currentTrack.title} ${currentTrack.author}`;
            } else {
                embed.setDescription(`There is no song playing! Please try again when a song is playing, or use \`/lyrics <song>\` to get a song's lyrics.`);
                return await interaction.editReply({ embeds: [embed] });
            }
        }

        // Validate the song variable
        if (!song || typeof song !== 'string' || song.trim() === '') {
            embed.setDescription(`Invalid song name provided. Please specify a valid song.`);
            return await interaction.editReply({ embeds: [embed] });
        }

        try {
            const searches = await genius.songs.search(song);
            if (!searches || searches.length === 0) {
                embed.setDescription(`Could not find lyrics for "${song}".`);
            } else {
                const songData = searches[0];
                const lyrics = await songData.lyrics();
                embed.setAuthor({ name: `${songData.title} - ${songData.artist.name}`, url: songData.url, iconURL: songData.thumbnail });
                embed.setDescription(formatLyrics(lyrics));
            }
        } catch (err) {
            embed.setDescription(`Could not find lyrics for "${song}".`);
            logger.error(`Error when finding lyrics for "${song}":\n${err.stack || err}`);
        }

        await interaction.editReply({ embeds: [embed] });
    },
};