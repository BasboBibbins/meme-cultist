const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { roll } = require('../../utils/roll');
const { randomHexColor } = require('../../utils/randomcolor');

module.exports = {
    data: new SlashCommandBuilder()
        .setName("roll")
        .setDescription("Roll a die. Default is a 6-sided die.")
        .addIntegerOption(option =>
            option.setName('dice')
                .setDescription('The number of sides on the die.')
                .setRequired(false)
                .setMinValue(2))
        .addIntegerOption(option =>
            option.setName('number')
                .setDescription('The number of dice to roll.')
                .setRequired(false)
                .setMaxValue(500)),
    async execute(interaction) {
        const dice = interaction.options.getInteger('dice') || 6;
        const number = interaction.options.getInteger('number') || 1;
        
        const embed = new EmbedBuilder()
        .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
        .setDescription(`${number > 1 ? `You rolled **${number} ${dice}**-sided dice and got:` : `You rolled a **${dice}**-sided die and got:`}\n**${await roll(dice, number)}**`)
        .setColor(randomHexColor())
        .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();
        await interaction.reply({ embeds: [embed], fetchReply: true});
    },
};