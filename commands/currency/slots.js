const { SlashCommandBuilder } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: "./db/users.sqlite" });

const { addNewDBUser } = require("../../database");

const { CURRENCY_NAME } = require("../../config.json");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("slots")
        .setDescription(`Play a game of slots for ${CURRENCY_NAME}.`)
        .addIntegerOption(option =>
            option.setName('bet')
                .setDescription('The amount of koku to bet.')
                .setRequired(true)),
    async execute(interaction) {
            // coming soon
    }
};