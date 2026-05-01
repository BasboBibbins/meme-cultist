const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { addNewDBUser, setDBValue, db } = require("../../database");
const { CURRENCY_NAME } = require("../../config.js");
const { parseBet } = require('../../utils/betparse');
const { roll, drawDice } = require('../../utils/roll');
const wait = require('node:timers/promises').setTimeout;
const logger = require("../../utils/logger");
const { randomHexColor } = require('../../utils/randomcolor');
const { TESTING_MODE } = require('../../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName("craps")
        .setDescription(`Play a game of craps for ${CURRENCY_NAME}.`)
        .addStringOption(option =>
            option.setName('bet')
                .setDescription(`The amount of ${CURRENCY_NAME} to bet.`)
                .setRequired(true)),
    async execute(interaction) {
        // TODO: create a craps game using techniques similar to roulette and poker.

        await interaction.reply({content: `Craps is currently unavailable. Check back later!`, ephemeral: true});
    }
};
