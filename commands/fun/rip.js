const { SlashCommandBuilder } = require('discord.js');
const { rip } = require("../../utils/welcome");
const { RIP_CHANNEL } = require("../../config.json");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("rip")
        .setDescription("RIP someone.")
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to RIP.')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('The prompt for the RIP.')
                .setRequired(false)),
    async execute(interaction) {
        if (!interaction.member.permissions.has("ADMINISTRATOR")) {
            await interaction.reply({ content: "You do not have permission to use this command!", ephemeral: true });
            return;
        }
        const user = interaction.options.getUser('user');
        const guildMember = await interaction.guild.members.fetch(user.id);
        const prompt = interaction.options.getString('prompt') || "you will never be forgotten";
        if (prompt > 250) {
            await interaction.reply({ content: "The prompt cannot be longer than 250 characters!", ephemeral: true });
            return;
        }
        const channel = RIP_CHANNEL || interaction.member.guild.channels.cache.find(ch => ch.name === 'rip');
        await rip(interaction.client, guildMember, prompt);
        await interaction.reply({ content: `Done! Check the <#${channel}> channel for the message!`, ephemeral: true });
    },
};