const {slashCommandBuilder, SlashCommandBuilder} = require('discord.js');
const {joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, entersState, VoiceConnectionStatus} = require('@discordjs/voice');
const fbi = createAudioResource('assets/sounds/fbi.mp3');
const logger = require("../../utils/logger");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("fbi")
        .setDescription("Open up!"),
    async execute(interaction) {
        const channel = interaction.member.voice.channel;
        if (!channel) return interaction.reply({content: "You must be in a voice channel to use this command.", ephemeral: true});
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator
        });
        const player = createAudioPlayer();
        player.play(fbi);
        connection.subscribe(player);
        await interaction.reply({content: "FBI OPEN UP!", ephemeral: true});
        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 30e3);
            await entersState(player, AudioPlayerStatus.Playing, 5e3);
        } catch (error) {
            logger.error(error);
            connection.destroy();
            return interaction.reply({content: "There was an error while playing the audio.", ephemeral: true});
        } finally {
            await entersState(player, AudioPlayerStatus.Idle, 5e3);
            player.stop();
            connection.destroy();
        }
    }
};