const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, AttachmentBuilder } = require('discord.js');
const { QuickDB } = require('quick.db');
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const { addNewDBUser } = require('../../database');
const { CURRENCY_NAME, ROULETTE_MIN_BET, ROULETTE_MAX_BET, ROULETTE_BETTING_TIME } = require('../../config.json');
const { parseBet } = require('../../utils/betparse');
const { drawRouletteTable, drawResult, spinWheel, calculateWinnings, getRedBlack, getNumberPosition } = require('../../utils/roulette');
const logger = require('../../utils/logger');
const { randomHexColor } = require('../../utils/randomcolor');
const wait = require('node:timers/promises').setTimeout;

const BET_TYPES = [
    { name: 'Straight (single number 0-36)', value: 'straight' },
    { name: 'Red', value: 'red' },
    { name: 'Black', value: 'black' },
    { name: 'Even', value: 'even' },
    { name: 'Odd', value: 'odd' },
    { name: '1-18 (Low)', value: 'low' },
    { name: '19-36 (High)', value: 'high' },
    { name: '1st Dozen (1-12)', value: 'dozen1' },
    { name: '2nd Dozen (13-24)', value: 'dozen2' },
    { name: '3rd Dozen (25-36)', value: 'dozen3' },
    { name: 'Column 1', value: 'column1' },
    { name: 'Column 2', value: 'column2' },
    { name: 'Column 3', value: 'column3' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roulette')
        .setDescription(`Play a game of roulette for ${CURRENCY_NAME}.`)
        .addStringOption(option =>
            option.setName('type')
                .setDescription('The type of bet.')
                .setRequired(true)
                .addChoices(...BET_TYPES))
        .addStringOption(option =>
            option.setName('amount')
                .setDescription(`The amount of ${CURRENCY_NAME} to bet.`)
                .setRequired(true))
        .addStringOption(option =>
            option.setName('number')
                .setDescription('The number to bet on (0-36). Required for straight bets.')
                .setRequired(false)),
    async execute(interaction) {
        const client = interaction.client;
        const user = interaction.user;
        const channelId = interaction.channelId;
        const channel = interaction.channel;

        const betType = interaction.options.getString('type');
        const betNumber = interaction.options.getString('number');
        const betAmountStr = interaction.options.getString('amount');

        const errorEmbed = (description) => new EmbedBuilder()
            .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setColor(0xFF0000)
            .setDescription(description)
            .setFooter({ text: `${client.user.username} | Version ${require('../../package.json').version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        // Validate bet amount
        const bet = Number(await parseBet(betAmountStr, user.id));
        if (isNaN(bet)) {
            return await interaction.reply({ embeds: [errorEmbed(`You must bet a valid amount of ${CURRENCY_NAME}!`)], ephemeral: true });
        }
        if (bet % 1 !== 0) {
            return await interaction.reply({ embeds: [errorEmbed(`You must bet in whole numbers!`)], ephemeral: true });
        }
        if (ROULETTE_MIN_BET && bet < ROULETTE_MIN_BET) {
            return await interaction.reply({ embeds: [errorEmbed(`You must bet at least ${ROULETTE_MIN_BET} ${CURRENCY_NAME}!`)], ephemeral: true });
        }
        if (ROULETTE_MAX_BET && bet > ROULETTE_MAX_BET) {
            return await interaction.reply({ embeds: [errorEmbed(`You can bet at most ${ROULETTE_MAX_BET} ${CURRENCY_NAME}!`)], ephemeral: true });
        }

        let parsedNumber = null;
        if (betType === 'straight') {
            if (!betNumber) {
                return await interaction.reply({ embeds: [errorEmbed(`You must specify a number to bet on (0-36)!`)], ephemeral: true });
            }
            parsedNumber = parseInt(betNumber);
            if (isNaN(parsedNumber) || parsedNumber < 0 || parsedNumber > 36) {
                return await interaction.reply({ embeds: [errorEmbed(`You must bet on a number between 0 and 36!`)], ephemeral: true });
            }
        }

        // Check for existing game in this channel
        const existingGame = client.rouletteGames.get(channelId);

        if (!existingGame) {
            // Create a new game
            await handleNewGame(interaction, client, user, betType, parsedNumber, bet);
        } else if (existingGame.status === 'betting') {
            // Add bet to existing game
            await handleAddBet(interaction, client, user, betType, parsedNumber, bet, existingGame);
        } else {
            // Game is spinning or resolved
            return await interaction.reply({ embeds: [errorEmbed(`This game's betting period has ended. Please wait for the next game.`)], ephemeral: true });
        }
    }
};

async function handleNewGame(interaction, client, user, betType, parsedNumber, bet) {
    const channel = interaction.channel;

    let dbUser = await db.get(user.id);
    if (!dbUser) {
        logger.warn(`No database entry for user ${user.username} (${user.id}), creating one...`);
        await addNewDBUser(user);
    }

    const currentBalance = await db.get(`${user.id}.balance`) || 0;
    if (bet > currentBalance) {
        return await interaction.reply({ embeds: [new EmbedBuilder()
            .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setColor(0xFF0000)
            .setDescription(`Insufficient funds in wallet!`)
            .setFooter({ text: `${client.user.username} | Version ${require('../../package.json').version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp()
        ], ephemeral: true });
    }

    await db.sub(`${user.id}.balance`, bet);

    const stats = `${user.id}.stats.roulette`;
    await db.add(`${stats}.totalBet`, bet);

    logger.log(`${user.username} (${user.id}) started a roulette game with bet ${bet} ${CURRENCY_NAME} on ${betType}${parsedNumber !== null ? ' ' + parsedNumber : ''}`);

    await interaction.deferReply();

    let chipNumber = parsedNumber;
    if (!chipNumber) {
        switch (betType) {
            case 'red': chipNumber = 'red'; break;
            case 'black': chipNumber = 'black'; break;
            case 'even': chipNumber = 'even'; break;
            case 'odd': chipNumber = 'odd'; break;
            case 'low': chipNumber = 'low'; break;
            case 'high': chipNumber = 'high'; break;
            case 'dozen1': chipNumber = 'dozen1'; break;
            case 'dozen2': chipNumber = 'dozen2'; break;
            case 'dozen3': chipNumber = 'dozen3'; break;
            case 'column1': chipNumber = 'column1'; break;
            case 'column2': chipNumber = 'column2'; break;
            case 'column3': chipNumber = 'column3'; break;
        }
    }

    const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 256 });
    const bets = [{ number: chipNumber, amount: bet, userId: user.id, username: user.displayName, type: betType, numberValue: parsedNumber }];

    const tableFile = await drawRouletteTable(bets, { [user.id]: avatarUrl });

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('roulette_spin')
                .setLabel('Spin Now')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('roulette_cancel')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Danger)
        );

    const betsDescription = buildBetsDescription(bets);
    const embed = new EmbedBuilder()
        .setAuthor({ name: `${user.displayName}'s Roulette Game`, iconURL: user.displayAvatarURL({ dynamic: true }) })
        .setTitle('Place Your Bets!')
        .setDescription(`**Current Bets:**\n${betsDescription}`)
        .setColor(randomHexColor())
        .setFooter({ text: `Betting closes in ${ROULETTE_BETTING_TIME / 1000}s...`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp()
        .setImage('attachment://roulette.png');

    const message = await interaction.editReply({ embeds: [embed], files: [tableFile], components: [row] });

    const game = {
        channelId: interaction.channelId,
        messageId: message.id,
        creatorId: user.id,
        creatorUsername: user.displayName,
        bets: bets,
        userAvatars: { [user.id]: avatarUrl },
        status: 'betting',
        createdAt: Date.now(),
        endTime: Date.now() + ROULETTE_BETTING_TIME,
        collector: null,
        countdownInterval: null
    };

    client.rouletteGames.set(interaction.channelId, game);

    const collector = channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: ROULETTE_BETTING_TIME,
        filter: (i) => {
            if (i.customId === 'roulette_spin' || i.customId === 'roulette_cancel') {
                return i.user.id === user.id;
            }
            return false;
        }
    });

    game.collector = collector;
    game.countdownInterval = setInterval(async () => {
        const game = client.rouletteGames.get(interaction.channelId);
        if (!game || game.status !== 'betting') {
            clearInterval(game?.countdownInterval);
            return;
        }

        const remaining = Math.ceil((game.endTime - Date.now()) / 1000);
        if (remaining <= 0) {
            clearInterval(game.countdownInterval);
            return;
        }

        try {
            const currentBetsDescription = buildBetsDescription(game.bets);
            await message.edit({
                embeds: [embed.setDescription(`**Current Bets:**\n${currentBetsDescription}`).setFooter({ text: `Betting closes in ${remaining}s...`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })]
            });
        } catch (e) {
            clearInterval(game.countdownInterval);
        }
    }, 1000);

    collector.on('collect', async (i) => {
        if (i.customId === 'roulette_spin') {
            clearInterval(game.countdownInterval);
            game.collector.stop('spin');
        } else if (i.customId === 'roulette_cancel') {
            clearInterval(game.countdownInterval);
            // Refund all bets on cancellation
            for (const bet of game.bets) {
                await db.add(`${bet.userId}.balance`, bet.amount);
            }
            await i.update({
                embeds: [new EmbedBuilder()
                    .setTitle('Roulette Game Cancelled')
                    .setDescription('All bets have been refunded.')
                    .setColor(0xFFAA00)
                    .setTimestamp()
                ],
                files: [],
                components: []
            });
            client.rouletteGames.delete(interaction.channelId);
            return;
        }
    });

    collector.on('end', async (collected, reason) => {
        clearInterval(game.countdownInterval);
        const finalGame = client.rouletteGames.get(interaction.channelId);
        if (!finalGame || finalGame.status !== 'betting') return;

        if (reason === 'time') {
            // Timer expired - resolve the game
            await resolveGame(client, interaction.channel, message, finalGame);
        } else if (reason === 'spin') {
            // Spin button clicked
            await resolveGame(client, interaction.channel, message, finalGame);
        }
    });
}

async function handleAddBet(interaction, client, user, betType, parsedNumber, bet, game) {
    // Get user database entry
    let dbUser = await db.get(user.id);
    if (!dbUser) {
        await addNewDBUser(user);
    }

    const currentBalance = await db.get(`${user.id}.balance`) || 0;
    if (bet > currentBalance) {
        return await interaction.reply({ embeds: [new EmbedBuilder()
            .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setColor(0xFF0000)
            .setDescription(`Insufficient funds in wallet!`)
            .setFooter({ text: `${client.user.username} | Version ${require('../../package.json').version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp()
        ], ephemeral: true });
    }

    // Deduct bet
    await db.sub(`${user.id}.balance`, bet);

    // Track stats
    const stats = `${user.id}.stats.roulette`;
    await db.add(`${stats}.totalBet`, bet);

    logger.log(`${user.username} (${user.id}) added bet ${bet} ${CURRENCY_NAME} on ${betType}${parsedNumber !== null ? ' ' + parsedNumber : ''} to roulette game`);

    // Determine chip position
    let chipNumber = parsedNumber;
    if (!chipNumber) {
        switch (betType) {
            case 'red': chipNumber = 'red'; break;
            case 'black': chipNumber = 'black'; break;
            case 'even': chipNumber = 'even'; break;
            case 'odd': chipNumber = 'odd'; break;
            case 'low': chipNumber = 'low'; break;
            case 'high': chipNumber = 'high'; break;
            case 'dozen1': chipNumber = 'dozen1'; break;
            case 'dozen2': chipNumber = 'dozen2'; break;
            case 'dozen3': chipNumber = 'dozen3'; break;
            case 'column1': chipNumber = 'column1'; break;
            case 'column2': chipNumber = 'column2'; break;
            case 'column3': chipNumber = 'column3'; break;
        }
    }

    const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 256 });

    // Add bet to game (merge with existing bet on same spot for this user)
    const existingBet = game.bets.find(b =>
        b.userId === user.id &&
        b.type === betType &&
        b.number === chipNumber &&
        b.numberValue === parsedNumber
    );

    if (existingBet) {
        existingBet.amount += bet;
    } else {
        game.bets.push({
            number: chipNumber,
            amount: bet,
            userId: user.id,
            username: user.username,
            type: betType,
            numberValue: parsedNumber
        });
    }
    game.userAvatars[user.id] = avatarUrl;

    // Reset timer
    game.endTime = Date.now() + ROULETTE_BETTING_TIME;

    // Regenerate table image
    const tableFile = await drawRouletteTable(game.bets, game.userAvatars);

    // Build bets description
    const betsDescription = buildBetsDescription(game.bets);

    const embed = new EmbedBuilder()
        .setAuthor({ name: `${game.creatorUsername}'s Roulette Game`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
        .setTitle('Place Your Bets!')
        .setDescription(`**Current Bets:**\n${betsDescription}`)
        .setColor(randomHexColor())
        .setFooter({ text: `Betting closes in ${ROULETTE_BETTING_TIME / 1000}s...`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp()
        .setImage('attachment://roulette.png');

    // Acknowledge the user's bet
    const localEmbed = new EmbedBuilder()
        .setAuthor({ name: `Good luck!`, iconURL: user.displayAvatarURL({ dynamic: true }) })
        .setDescription(`Bet placed: ${bet} on ${formatBetType(betType, parsedNumber)}`)
        .setColor(randomHexColor())
        .setFooter({ text: `${client.user.username} | Version ${require('../../package.json').version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();
    await interaction.reply({ embeds: [localEmbed], ephemeral: true });

    // Update the game message
    try {
        const gameMessage = await interaction.channel.messages.fetch(game.messageId);
        await gameMessage.edit({ embeds: [embed], files: [tableFile] });

        // Reset collector timer
        if (game.collector) {
            game.collector.resetTimer();
        }
    } catch (e) {
        logger.error(`Error updating roulette game message: ${e.message}`);
    }
}

async function resolveGame(client, channel, message, game) {
    game.status = 'spinning';

    // Clear components
    await message.edit({ components: [] });

    // Get winning number
    const winningNumber = spinWheel();
    const color = getRedBlack(winningNumber);

    // Show spin animation
    const embed = new EmbedBuilder()
        .setAuthor({ name: `${game.creatorUsername}'s Roulette Game`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
        .setTitle('Spinning the wheel...')
        .setColor(randomHexColor())
        .setTimestamp()
        .setImage('attachment://roulette.png');

    const timeBetweenSpins = 500;
    for (let i = 0; i < 5; i++) {
        const randomNum = Math.floor(Math.random() * 37);
        const resultFile = await drawResult(randomNum, 0, false, game.bets, game.userAvatars);
        await message.edit({ embeds: [embed.setTitle('Spinning...')], files: [resultFile] });
        await wait(timeBetweenSpins);
    }

    // Show final winning number
    const winningNumberFile = await drawResult(winningNumber, 0, false, [], {});
    await message.edit({ embeds: [embed.setTitle(`Result: ${winningNumber}...`)], files: [winningNumberFile] });
    await wait(800);

    // Calculate results for each bet
    const results = [];
    for (const bet of game.bets) {
        const winnings = calculateWinnings(bet.type, bet.numberValue, bet.amount, winningNumber);
        const won = winnings > 0;

        if (won) {
            await db.add(`${bet.userId}.balance`, winnings);
            const stats = `${bet.userId}.stats.roulette`;
            await db.add(`${stats}.wins`, 1);

            const biggestWin = await db.get(`${stats}.biggestWin`) || 0;
            if (winnings > biggestWin) {
                await db.set(`${stats}.biggestWin`, winnings);
            }
        } else {
            const stats = `${bet.userId}.stats.roulette`;
            await db.add(`${stats}.losses`, 1);

            const biggestLoss = await db.get(`${stats}.biggestLoss`) || 0;
            if (bet.amount > biggestLoss) {
                await db.set(`${stats}.biggestLoss`, bet.amount);
            }
        }

        results.push({
            ...bet,
            winnings,
            won,
            newBalance: await db.get(`${bet.userId}.balance`)
        });
    }

    // Draw final result
    const totalWinnings = results.filter(r => r.won).reduce((sum, r) => sum + r.winnings, 0);
    const finalFile = await drawResult(winningNumber, totalWinnings, true, game.bets, game.userAvatars);

    const resultEmbed = new EmbedBuilder()
        .setAuthor({ name: `${game.creatorUsername}'s Roulette Game`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
        .setTitle(`Winning Number: ${winningNumber} (${color})`)
        .setDescription(`Total pool: ${game.bets.reduce((sum, b) => sum + b.amount, 0)} ${CURRENCY_NAME}\nTotal winnings paid: ${totalWinnings} ${CURRENCY_NAME}`)
        .setColor(color === 'red' ? 0xFF0000 : (color === 'black' ? 0x000000 : 0x00AA00))
        .setTimestamp()
        .setImage('attachment://roulette.png');

    await message.edit({ embeds: [resultEmbed], files: [finalFile] });

    // Group results by user and send one DM per bettor
    const resultsByUser = {};
    for (const result of results) {
        const uid = result.userId;
        if (!resultsByUser[uid]) {
            resultsByUser[uid] = [];
        }
        resultsByUser[uid].push(result);
    }
    for (const userId of Object.keys(resultsByUser)) {
        await sendResultDM(client, resultsByUser[userId], winningNumber, color);
    }

    // Clean up game state
    client.rouletteGames.delete(game.channelId);
}

async function sendResultDM(client, userResults, winningNumber, color) {
    if (userResults.length === 0) return;
    const first = userResults[0];
    const userId = first.userId;

    try {
        const dmUser = await client.users.fetch(userId);
        const totalBet = userResults.reduce((sum, r) => sum + r.amount, 0);
        const totalWon = userResults.reduce((sum, r) => sum + r.winnings, 0);
        const net = totalWon - totalBet;
        const newBalance = first.newBalance;

        const betLines = userResults.map(r => {
            const desc = formatBetType(r.type, r.numberValue);
            const outcome = r.won ? `W` : `L`;
            return `• ${r.amount} ${CURRENCY_NAME} on ${desc} **(${outcome})**`;
        }).join('\n');

        const summary = `${userResults.length > 0 ? `**Total bet:** ${totalBet} ${CURRENCY_NAME}\n` : ''}**Total won:** ${totalWon} ${CURRENCY_NAME}\n**Net:** ${net >= 0 ? '+' : ''}${net} ${CURRENCY_NAME}\n\nYour new balance is **${newBalance}** ${CURRENCY_NAME}.`;
        const description = `Winning Number: ${winningNumber} (${color})\n\n**Your bet${userResults.length > 1 ? 's' : ''}:**\n${betLines}\n\n${summary}`;

        const embed = new EmbedBuilder()
            .setTitle(net > 0 ? 'Roulette Results - You Won!' : (net < 0 ? 'Roulette Results - You Lost' : 'Roulette Results'))
            .setDescription(description)
            .setColor(net > 0 ? 0x00AA00 : (net < 0 ? 0xFF0000 : 0x888888))
            .setTimestamp();

        await dmUser.send({ embeds: [embed] });
    } catch (e) {
        logger.warn(`Could not send DM to user ${userId}: ${e.message}`);
    }
}

function formatBetType(type, number) {
    switch (type) {
        case 'straight': return `Straight on ${number}`;
        case 'red': return 'Red';
        case 'black': return 'Black';
        case 'even': return 'Even';
        case 'odd': return 'Odd';
        case 'low': return '1-18';
        case 'high': return '19-36';
        case 'dozen1': return '1st 12';
        case 'dozen2': return '2nd 12';
        case 'dozen3': return '3rd 12';
        case 'column1': return 'Column 1';
        case 'column2': return 'Column 2';
        case 'column3': return 'Column 3';
        default: return type;
    }
}

function buildBetsDescription(bets) {
    const byUser = {};
    for (const bet of bets) {
        if (!byUser[bet.userId]) {
            byUser[bet.userId] = { displayName: bet.username, total: 0, bets: [] };
        }
        byUser[bet.userId].total += bet.amount;
        byUser[bet.userId].bets.push(`${formatBetType(bet.type, bet.numberValue)} (${bet.amount})`);
    }

    let desc = '';
    for (const [userId, data] of Object.entries(byUser)) {
        desc += `• ${data.displayName}: ${data.total} on ${data.bets.join(', ')}\n`;
    }
    return desc || 'No bets yet';
}