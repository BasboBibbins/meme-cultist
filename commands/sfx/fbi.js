const {slashCommandBuilder, SlashCommandBuilder} = require('discord.js');
const {joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, entersState, VoiceConnectionStatus} = require('@discordjs/voice');
const fbi = 'assets/sfx/fbi.mp3';

module.exports = {
    data: new SlashCommandBuilder()
        .setName("fbi")
        .setDescription("Open up!"),
    async execute(interaction) {
        // play the fbi sound effect
        const connection = joinVoiceChannel({
            channelId: interaction.member.voice.channel.id,
            guildId: interaction.guild.id,
            adapterCreator: interaction.guild.voiceAdapterCreator,
        });
        const player = createAudioPlayer();
        const resource = createAudioResource(fbi);
        player.play(resource);
        connection.subscribe(player);

        // wait for the sound effect to finish playing
        try {
            await entersState(player, AudioPlayerStatus.Idle, 5e3);
            await interaction.reply({content: "🚨"}, {ephemeral: true});
        } catch (error) {
            console.error(error);
            await interaction.reply({content: "Failed to play sound effect", ephemeral: true});
            connection.destroy();
        } finally {
            await Promise.race([
                entersState(connection, VoiceConnectionStatus.Destroyed, 5e3),
                entersState(player, AudioPlayerStatus.Idle, 5e3),
            ]);
        }
    },
};