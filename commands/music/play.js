const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const ytdl = require('ytdl-core');
const ytsr = require('ytsr');
const ytpl = require('ytpl');
const { getQueue, addToQueue, removeFromQueue, clearQueue } = require('../../utils/musicQueue');

module.exports = {
    data: new SlashCommandBuilder()
        .setName("play")
        .setDescription("Play a song or playlist from YouTube.")
        .addStringOption(option => option.setName("query").setDescription("The YouTube link or search query.").setRequired(true)),
    async execute(interaction) {
        const query = interaction.options.getString("query");
    },
};