const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const { addNewDBUser, setDBValue } = require("../../database");
const { CURRENCY_NAME } = require("../../config.json");
const { parseBet } = require('../../utils/betparse');
const { roll, drawDice } = require('../../utils/roll');
const wait = require('node:timers/promises').setTimeout;
const logger = require("../../utils/logger");
const { randomHexColor } = require('../../utils/randomcolor');
const { TESTING_MODE } = require('../../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName("craps")
        .setDescription(`Play a game of craps for ${CURRENCY_NAME}.`)
        .addStringOption(option =>
            option.setName('bet')
                .setDescription(`The amount of ${CURRENCY_NAME} to bet.`)
                .setRequired(true)),
    async execute(interaction) {
        if (TESTING_MODE) {        
            const user = interaction.user;
            const option = interaction.options.getString('bet');
            const stats = `${user.id}.stats.craps`;

            let bet = Number(await parseBet(option, user.id));
            const dbUser = await db.get(user.id);

            if (db.get(stats) === undefined) {
                db.set(stats, { wins: 0, losses: 0, royals: 0, biggestWin: 0, biggestLoss: 0 });
            }

            logger.info(`User ${user.username} is playing craps with a bet of ${bet} ${CURRENCY_NAME}.`);

            const error_embed = new EmbedBuilder()
                .setAuthor({name: interaction.user.displayName, iconURL: interaction.user.displayAvatarURL({dynamic: true})})
                .setColor(0xFF0000)
                .setTitle('Error')
                .setFooter({text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true})})
                .setTimestamp();
    
            if (!dbUser) {
                await addNewDBUser(user.id);
                error_embed.setDescription(`You don't have an account! Please try using the \`daily\` command and then try again.`);
                return interaction.reply({ embeds: [error_embed], ephemeral: true });
            }
            if (bet > dbUser.balance) {
                error_embed.setDescription(`You don't have enough ${CURRENCY_NAME}!`);
                return interaction.reply({ embeds: [error_embed], ephemeral: true });
            }
            if (bet < 1) {
                error_embed.setDescription(`You must bet at least 1 ${CURRENCY_NAME}!`);
                return interaction.reply({ embeds: [error_embed], ephemeral: true });
            }
            if (bet % 1 !== 0) {
                error_embed.setDescription(`You must bet in whole numbers!`);
                return interaction.reply({ embeds: [error_embed], ephemeral: true });
            }
            
            let msg = await interaction.deferReply();
            const dice = [await roll(6, 1), await roll(6, 1)];

            const diceImage = await drawDice(dice[0], dice[1]);

            const embed = new EmbedBuilder()
            .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setColor(randomHexColor())
            .setImage(`attachment://roll.png`)
            .setFooter({ text: `Bet: ${bet} ${CURRENCY_NAME} | Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

            logger.debug(dice.join(', '));
            
            if (dice[0] === 1 && dice[1] === 1) {
                embed.setDescription(`You rolled a **2** and lost **${bet}** ${CURRENCY_NAME}!`);
                return await interaction.editReply({ embeds: [embed], files: [diceImage], fetchReply: true });
            } else if (dice[0] === 6 && dice[1] === 6) {
                embed.setDescription(`You rolled a **12** and won **${bet * 7}** ${CURRENCY_NAME}!`);
                return await interaction.editReply({ embeds: [embed], files: [diceImage], fetchReply: true });
            } else if (dice[0] + dice[1] === 7 || dice[0] + dice[1] === 11) {
                embed.setDescription(`You rolled a **${dice[0] + dice[1]}** and won **${bet}** ${CURRENCY_NAME}!`);
                return await interaction.editReply({ embeds: [embed], files: [diceImage], fetchReply: true });
            } else if (dice[0] + dice[1] === 2 || dice[0] + dice[1] === 3 || dice[0] + dice[1] === 12) {
                embed.setDescription(`You rolled a **${dice[0] + dice[1]}** and lost **${bet}** ${CURRENCY_NAME}!`);
                return await interaction.editReply({ embeds: [embed], files: [diceImage], fetchReply: true });
            } else {
                embed.setDescription(`You rolled a **${dice[0] + dice[1]}**. Roll again to win or lose!`);
                return await interaction.editReply({ embeds: [embed], files: [diceImage], fetchReply: true });
            }
        } else {
            const error_embed = new EmbedBuilder()
                .setAuthor({name: interaction.user.displayName, iconURL: interaction.user.displayAvatarURL({dynamic: true})})
                .setColor(0xFF0000)
                .setTitle('Error')
                .setFooter({text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true})})
                .setTimestamp();
            error_embed.setDescription(`This command is currently disabled.`);
            return interaction.reply({ embeds: [error_embed], ephemeral: true });
        }
    }
};
