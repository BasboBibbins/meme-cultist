const { SlashCommandBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const { addNewDBUser, setDBValue } = require("../../database");
const { CURRENCY_NAME } = require("../../config.json");
const { parseBet } = require('../../utils/betparse');
const { roll, drawDice } = require('../../utils/roll');
const wait = require('node:timers/promises').setTimeout;
const logger = require("../../utils/logger");
const { randomHexColor } = require('../../utils/randomcolor');

module.exports = {
    data: new SlashCommandBuilder()
        .setName("craps")
        .setDescription(`Play a game of craps for ${CURRENCY_NAME}.`)
        .addStringOption(option =>
            option.setName('bet')
                .setDescription(`The amount of ${CURRENCY_NAME} to bet.`)
                .setRequired(true)),
    async execute(interaction) {
        const user = interaction.user;
        const option = interaction.options.getString('bet');
        const stats = `${user.id}.stats.craps`;

        let bet = Number(await parseBet(option, user.id));
        const dbUser = await db.get(user.id);

        if (db.get(stats) === undefined) {
            db.set(stats, { wins: 0, losses: 0, royals: 0, biggestWin: 0, biggestLoss: 0 });
        }

        logger.info(`User ${user.username}#${user.discriminator} is playing craps with a bet of ${bet} ${CURRENCY_NAME}.`);

        const error_embed = new EmbedBuilder()
            .setAuthor({name: interaction.user.username+"#"+interaction.user.discriminator, iconURL: interaction.user.displayAvatarURL({dynamic: true})})
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

        const modal = new ModalBuilder()
            .setCustomId('pre-roll')
            .setTitle('Craps')

        const input = new TextInputBuilder()
            .setCustomId('pre-roll-input')
            .setLabel('Prediction')
            .setPlaceholder('What do you think the total will be?')
            .setMinLength(1)
            .setMaxLength(7) // hard + input
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const row = new ActionRowBuilder().addComponents(input);

        modal.addComponents(row);
        
        await interaction.showModal(modal);
        
        const submitted = await interaction.awaitModalSubmit({ filter: (i) => i.user.id === interaction.user.id, time: 30000 })
            .catch(error => {
                logger.error(error)
                return null;
            });

        if (submitted) {
            const prediction = submitted.fields.getTextInputValue('pre-roll-input');
            if (prediction.toLowerCase().includes('hard') || prediction.toLowerCase().includes('soft')) {
                logger.debug(`prediction: ${prediction} type: ${typeof prediction}`);
            }

            logger.debug(`prediction: ${prediction} type: ${typeof prediction}`);

            const dice = [await roll(6, 1), await roll(6, 1)];

            const diceImage = await drawDice(dice[0], dice[1]);
    
            const embed = new EmbedBuilder()
            .setAuthor({ name: user.username, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setColor(randomHexColor())
            .setImage(`attachment://roll.png`)
            .setFooter({ text: `Bet: ${bet} ${CURRENCY_NAME} | Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();
    
            let msg = await interaction.editReply({ embeds: [embed], files: [diceImage], fetchReply: true });
    
            logger.debug(dice.join(', '));


        }
    }
};