const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { QueryType } = require('discord-player');
const logger = require('../../utils/logger');


module.exports = {
    data: new SlashCommandBuilder()
        .setName("playlocal")
        .setDescription("Play a local file.")
        .addAttachmentOption(option => option.setName("file").setDescription("The file to play.").setRequired(true)),
    async execute(interaction) {
        const player = interaction.client.player;
        const embed = new EmbedBuilder()
        .setColor(0x00AE86)
        .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true}) })
        .setTimestamp();

        interaction.deferReply({ ephemeral: true });
        const file = interaction.options.getAttachment("file");
        if (!file) {
            embed.setTitle("Error");
            embed.setDescription("No file was provided.");
            return await interaction.editReply({embeds: [embed], ephemeral: true});
        }
        // check if file is audio/video file
        if (!file.contentType.startsWith("audio") && !file.contentType.startsWith("video")) {
            embed.setTitle("Error");
            embed.setColor(0xFF0000);
            embed.setDescription("File is not an audio or video file.");
            return await interaction.editReply({embeds: [embed], ephemeral: true});
        }

        const queue = player.createQueue(interaction.guild, {
            leaveOnEnd: true,
            autoSelfDeaf: true,
            leaveOnStop: true,
            repeatMode: 0,
            intialVolume: 100,
            equalizer: [
                { band: 0, gain: 0.15 },
                { band: 1, gain: 0.10 },
                { band: 2, gain: 0.05 }
            ],
            metadata: {
                channel: interaction.channel,
                requestedBy: interaction.user
            }
        });

        try {
            if (!queue.connection) await queue.connect(interaction.member.voice.channelId);
        }
        catch (error) {
            logger.error(error);
            embed.setTitle("Could not join voice channel!");
            embed.setDescription("I could not join your voice channel. Please make sure I have permission to join and speak in your voice channel.");
            return await interaction.editReply({embeds: [embed], ephemeral: true});
        }

        const track = await player.search(file, {
            requestedBy: interaction.user,
            searchEngine: `ext:file`
        });

        if (track) {
            queue.addTrack(track);
            if (!queue.isPlaying()) await queue.node.play();
            embed.setTitle("Added to queue");
            embed.setDescription(`[${track.title}](${track.uri})`);
            await interaction.reply({embeds: [embed], ephemeral: true});
        }
    }
}