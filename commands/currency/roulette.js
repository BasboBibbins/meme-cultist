const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { QuickDB } = require('quick.db');
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const { addNewDBUser } = require('../../database');
const { CURRENCY_NAME, ROULETTE_MIN_BET, ROULETTE_MAX_BET } = require('../../config.json');
const { parseBet } = require('../../utils/betparse');
const { drawRouletteTable, drawResult, spinWheel, calculateWinnings, getRedBlack, ROULETTE_NUMBERS } = require('../../utils/roulette');
const logger = require('../../utils/logger');
const { randomHexColor } = require('../../utils/randomcolor');
const wait = require('node:timers/promises').setTimeout;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roulette')
        .setDescription(`Play a game of roulette for ${CURRENCY_NAME}.`)
        .addSubcommand(subcommand =>
            subcommand
                .setName('bet')
                .setDescription(`Place a bet on roulette.`)
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('The type of bet.')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Straight (single number 0-36)', value: 'straight' },
                            { name: 'Red', value: 'red' },
                            { name: 'Black', value: 'black' },
                            { name: 'Even', value: 'even' },
                            { name: 'Odd', value: 'odd' },
                            { name: '1-18 (Low)', value: 'low' },
                            { name: '19-36 (High)', value: 'high' },
                            { name: '1st Dozen (1-12)', value: 'dozen1' },
                            { name: '2nd Dozen (13-24)', value: 'dozen2' },
                            { name: '3rd Dozen (25-36)', value: 'dozen3' }
                        ))
                .addStringOption(option =>
                    option.setName('amount')
                        .setDescription(`The amount of ${CURRENCY_NAME} to bet.`)
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('number')
                        .setDescription('The number to bet on (0-36). Required for straight bets.')
                        .setRequired(false))),
    async execute(interaction) {
        const user = interaction.user;
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'bet') {
            const betType = interaction.options.getString('type');
            const betNumber = interaction.options.getString('number');
            const betAmountStr = interaction.options.getString('amount');

            const dbUser = await db.get(user.id);
            if (!dbUser) {
                logger.warn(`No database entry for user ${user.username} (${user.id}), creating one...`);
                await addNewDBUser(user);
            }

            const bet = Number(await parseBet(betAmountStr, user.id));
            const currentBalance = await db.get(`${user.id}.balance`) || 0;

            const error_embed = new EmbedBuilder()
                .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
                .setColor(0xFF0000)
                .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();

            // Validation
            if (isNaN(bet)) {
                error_embed.setDescription(`You must bet a valid amount of ${CURRENCY_NAME}!`);
                return await interaction.reply({ embeds: [error_embed], ephemeral: true });
            }
            if (bet < ROULETTE_MIN_BET) {
                error_embed.setDescription(`You must bet at least ${ROULETTE_MIN_BET} ${CURRENCY_NAME}!`);
                return await interaction.reply({ embeds: [error_embed], ephemeral: true });
            }
            if (bet > ROULETTE_MAX_BET) {
                error_embed.setDescription(`You can bet at most ${ROULETTE_MAX_BET} ${CURRENCY_NAME}!`);
                return await interaction.reply({ embeds: [error_embed], ephemeral: true });
            }
            if (bet > currentBalance) {
                error_embed.setDescription(`You don't have enough ${CURRENCY_NAME}!`);
                return await interaction.reply({ embeds: [error_embed], ephemeral: true });
            }
            if (bet % 1 !== 0) {
                error_embed.setDescription(`You must bet in whole numbers!`);
                return await interaction.reply({ embeds: [error_embed], ephemeral: true });
            }

            // Validate number for straight bets
            let parsedNumber = null;
            if (betType === 'straight') {
                if (!betNumber) {
                    error_embed.setDescription(`You must specify a number to bet on (0-36)!`);
                    return await interaction.reply({ embeds: [error_embed], ephemeral: true });
                }
                parsedNumber = parseInt(betNumber);
                if (isNaN(parsedNumber) || parsedNumber < 0 || parsedNumber > 36) {
                    error_embed.setDescription(`You must bet on a number between 0 and 36!`);
                    return await interaction.reply({ embeds: [error_embed], ephemeral: true });
                }
            }

            // Deduct bet and spin
            await db.sub(`${user.id}.balance`, bet);

            const stats = `${user.id}.stats.roulette`;
            await db.add(`${stats}.totalBet`, bet);

            logger.log(`${user.username} (${user.id}) bet ${bet} ${CURRENCY_NAME} on ${betType}${parsedNumber !== null ? ' ' + parsedNumber : ''} in roulette.`);

            // Show spinning animation
            await interaction.deferReply();

            const embed = new EmbedBuilder()
                .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
                .setTitle('Spinning the wheel...')
                .setColor(randomHexColor())
                .setFooter({ text: `Bet: ${bet} ${CURRENCY_NAME} | ${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();

            // Draw initial table
            const bets = [{ number: parsedNumber, amount: bet }];
            const tableFile = await drawRouletteTable(bets);
            embed.setImage('attachment://roulette.png');

            await interaction.editReply({ embeds: [embed], files: [tableFile] });

            // Spin animation - show multiple frames
            for (let i = 0; i < 5; i++) {
                await wait(1000);
                const randomNum = Math.floor(Math.random() * 37);
                const resultFile = await drawResult(randomNum, 0);
                await interaction.editReply({ embeds: [embed.setTitle('Spinning...')], files: [resultFile] });
            }

            // Final spin result
            const winningNumber = spinWheel();
            const winnings = calculateWinnings(betType, parsedNumber, bet, winningNumber);
            const color = getRedBlack(winningNumber);
            const colorHex = color === 'green' ? '#00aa00' : (color === 'red' ? '#ff0000' : '#000000');

            let resultTitle = '';
            let resultDescription = '';

            if (winnings > 0) {
                const profit = winnings;
                await db.add(`${user.id}.balance`, profit);
                await db.add(`${stats}.wins`, 1);

                if (profit > await db.get(`${stats}.biggestWin`)) {
                    await db.set(`${stats}.biggestWin`, profit);
                }

                resultTitle = 'You Won!';
                resultDescription = `The winning number was **${winningNumber}** (${color}).\n\nYou bet ${bet} ${CURRENCY_NAME} on ${betType}${parsedNumber !== null ? ' ' + parsedNumber : ''}.\n\nYou won **${profit}** ${CURRENCY_NAME}!\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`;
            } else {
                await db.add(`${stats}.losses`, 1);

                if (bet > await db.get(`${stats}.biggestLoss`)) {
                    await db.set(`${stats}.biggestLoss`, bet);
                }

                resultTitle = 'You Lost';
                resultDescription = `The winning number was **${winningNumber}** (${color}).\n\nYou bet ${bet} ${CURRENCY_NAME} on ${betType}${parsedNumber !== null ? ' ' + parsedNumber : ''}.\n\nYou lost your bet of **${bet}** ${CURRENCY_NAME}.\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`;
            }

            // Draw final result
            const finalFile = await drawResult(winningNumber, winnings, true);

            const resultEmbed = new EmbedBuilder()
                .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
                .setTitle(resultTitle)
                .setDescription(resultDescription)
                .setColor(colorHex === '#ff0000' ? 0xff0000 : (colorHex === '#000000' ? 0x000000 : 0x00aa00))
                .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();

            await interaction.editReply({ embeds: [resultEmbed], files: [finalFile], components: [] });
        }
    }
};