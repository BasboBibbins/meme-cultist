const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { randomHexColor } = require('../../utils/randomcolor');
const { lyricsExtractor } = require('@discord-player/extractor');

const lyricsClient = lyricsExtractor(process.env.GENIUS_KEY);


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
            .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();
        
        const currentTrack = require('../../utils/musicPlayer').currentTrack;
        let song = interaction.options.getString('song');
        if (!song) {
            if (currentTrack) {
                song = currentTrack.title.includes(' - ') ? `${currentTrack.title.split(' - ')[1]} ${currentTrack.title.split(' - ')[0]}` : `${currentTrack.title} ${currentTrack.author}`;
            } else {
                embed.setDescription(`There is no song playing! Please try again when a song is playing, otherwise use \`/lyrics <song>\` to get a song's lyrics.`); 
                return await interaction.editReply({ embeds: [embed] });
            }
        }

        await lyricsClient
            .search(song)
            .then(async (x) => {
                embed.setAuthor({ name: `${x.title} - ${x.artist.name}`, url: x.url, iconURL: x.artist.image || `https://www.google.com/s2/favicons?domain=https://genius.com/` });
                embed.setDescription(`\`\`\`${x.lyrics}\`\`\``);
            })
            .catch(async (err) => {
                embed.setDescription(`Could not find lyrics for ${song}`);
            });
        await interaction.editReply({ embeds: [embed] });
    },
};

