const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { QuickDB } = require('quick.db');
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const { addNewDBUser } = require('../../database');
const { CURRENCY_NAME, RACE_MIN_BET, RACE_MAX_BET, RACE_BETTING_TIME, RACE_HOUSE_EDGE, RACE_ANIMATION_TICKS, RACE_TICK_INTERVAL, RACE_PLACE_MULTIPLIER, RACE_SHOW_MULTIPLIER } = require('../../config.js');
const { parseBet } = require('../../utils/betparse');
const { generateHorses, determineTopThree, calculatePayout, buildBettingDescription, buildRaceDescription, buildRaceTitle, advanceRace, generateRaceCommentary } = require('../../utils/race');
const logger = require('../../utils/logger');
const { randomHexColor } = require('../../utils/randomcolor');
const wait = require('node:timers/promises').setTimeout;

const HOUSE_EDGE = RACE_HOUSE_EDGE ?? 0.10;
const BETTING_TIME = RACE_BETTING_TIME ?? 20000;
const ANIMATION_TICKS = RACE_ANIMATION_TICKS ?? 10;
const TICK_INTERVAL = RACE_TICK_INTERVAL ?? 1500;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('race')
        .setDescription(`Horse racing betting game for ${CURRENCY_NAME}.`)
        .addSubcommand(subcommand =>
            subcommand
                .setName('start')
                .setDescription('Start a new horse race.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('bet')
                .setDescription('Place a bet on the current horse race.')
                .addIntegerOption(option =>
                    option.setName('horse')
                        .setDescription('The horse number to bet on (1-8)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(8))
                .addStringOption(option =>
                    option.setName('amount')
                        .setDescription(`The amount of ${CURRENCY_NAME} to bet.`)
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('Bet type: Win (1st), Place (1st-2nd), Show (1st-3rd)')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Win (must finish 1st)', value: 'win' },
                            { name: 'Place (must finish 1st or 2nd)', value: 'place' },
                            { name: 'Show (must finish 1st, 2nd, or 3rd)', value: 'show' }
                        ))),

    async execute(interaction) {
        const client = interaction.client;
        const user = interaction.user;
        const channelId = interaction.channelId;
        const channel = interaction.channel;
        const subcommand = interaction.options.getSubcommand();

        if (!client.raceGames) {
            client.raceGames = new Map();
        }

        if (subcommand === 'start') {
            await handleStartRace(interaction, client, user);
        } else if (subcommand === 'bet') {
            await handleBet(interaction, client, user);
        }
    }
};

async function handleStartRace(interaction, client, user) {
    const channelId = interaction.channelId;
    const channel = interaction.channel;

    const existingGame = client.raceGames.get(channelId);
    if (existingGame) {
        const phaseMsg = existingGame.phase === 'betting'
            ? 'A race is already accepting bets! Use `/race bet` to place your wager.'
            : 'A race is already in progress. Please wait for it to finish.';

        const embed = new EmbedBuilder()
            .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setColor(0xFF0000)
            .setDescription(phaseMsg)
            .setTimestamp();
        return await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    await interaction.deferReply();

    const horses = generateHorses();
    const topThree = determineTopThree(horses);

    logger.log(`${user.username} (${user.id}) started a horse race. Winner: Horse ${topThree.first.number} (${topThree.first.name}), 2nd: ${topThree.second.number}, 3rd: ${topThree.third.number}`);

    // Generate commentary asynchronously (don't await - use default if not ready)
    let commentaryPromise = null;
    if (OPENAI_API_KEY) {
        commentaryPromise = generateRaceCommentary(OPENAI_API_KEY);
    }

    const endTime = Date.now() + BETTING_TIME;
    const betsDescription = buildBettingDescription(horses, [], endTime);

    const embed = new EmbedBuilder()
        .setAuthor({ name: `🏇 Horse Race Started by ${user.displayName}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
        .setTitle('🏇 Place Your Bets! 🏇')
        .setDescription(betsDescription)
        .setColor(randomHexColor())
        .setFooter({ text: `Betting closes in ${BETTING_TIME / 1000}s • Use /race bet to wager`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();

    // Buttons - only creator can start/cancel
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('race_start_now')
                .setLabel('Start Now')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('race_cancel')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Danger)
        );

    const message = await interaction.editReply({ embeds: [embed], components: [row] });

    const game = {
        channelId: interaction.channelId,
        messageId: message.id,
        creatorId: user.id,
        horses: horses,
        topThree: {
            firstIndex: topThree.firstIndex,
            secondIndex: topThree.secondIndex,
            thirdIndex: topThree.thirdIndex
        },
        winnerIndex: topThree.firstIndex, // Keep for backwards compatibility
        bets: [],
        phase: 'betting',
        endTime: endTime,
        collector: null,
        countdownInterval: null,
        commentary: null // Will be populated during betting phase
    };

    client.raceGames.set(interaction.channelId, game);

    const collector = channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: BETTING_TIME,
        filter: (i) => {
            if (i.customId === 'race_start_now' || i.customId === 'race_cancel') {
                return i.user.id === user.id;
            }
            return false;
        }
    });

    game.collector = collector;

    // Wait for commentary to generate (or timeout after 10 seconds)
    if (commentaryPromise) {
        try {
            game.commentary = await Promise.race([
                commentaryPromise,
                new Promise(resolve => setTimeout(() => resolve(null), 10000))
            ]);
            if (game.commentary) {
                logger.debug(`Race commentary generated: ${game.commentary.length} lines`);
            }
        } catch (e) {
            logger.warn(`Failed to generate race commentary: ${e.message}`);
        }
    }

    game.countdownInterval = setInterval(async () => {
        const currentGame = client.raceGames.get(interaction.channelId);
        if (!currentGame || currentGame.phase !== 'betting') {
            clearInterval(currentGame?.countdownInterval);
            return;
        }

        const remaining = Math.ceil((currentGame.endTime - Date.now()) / 1000);
        if (remaining <= 0) {
            clearInterval(currentGame.countdownInterval);
            return;
        }

        try {
            const newDesc = buildBettingDescription(currentGame.horses, currentGame.bets, currentGame.endTime);
            await message.edit({
                embeds: [embed.setDescription(newDesc).setFooter({ text: `Betting closes in ${remaining}s • Use /race bet to wager`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })]
            });
        } catch (e) {
            clearInterval(currentGame.countdownInterval);
        }
    }, 1000);

    collector.on('collect', async (i) => {
        if (i.customId === 'race_start_now') {
            clearInterval(game.countdownInterval);
            game.collector.stop('start');
        } else if (i.customId === 'race_cancel') {
            clearInterval(game.countdownInterval);
            for (const b of game.bets) {
                await db.add(`${b.userId}.balance`, b.amount);
                await db.sub(`${b.userId}.stats.race.totalBet`, b.amount);
            }
            await i.update({
                embeds: [new EmbedBuilder()
                    .setTitle('Race Cancelled')
                    .setDescription('All bets have been refunded.')
                    .setColor(0xFFAA00)
                    .setTimestamp()],
                components: []
            });
            client.raceGames.delete(interaction.channelId);
            return;
        }
    });

    collector.on('end', async (collected, reason) => {
        clearInterval(game.countdownInterval);
        const finalGame = client.raceGames.get(interaction.channelId);
        if (!finalGame || finalGame.phase !== 'betting') return;

        if (reason === 'time' || reason === 'start') {
            await resolveRace(client, channel, message, finalGame);
        }
    });
}

async function handleBet(interaction, client, user) {
    const channelId = interaction.channelId;
    const horseNumber = interaction.options.getInteger('horse');
    const betAmountStr = interaction.options.getString('amount');
    const betType = interaction.options.getString('type') || 'win';

    const errorEmbed = (description) => new EmbedBuilder()
        .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
        .setColor(0xFF0000)
        .setDescription(description)
        .setTimestamp();

    // Check for existing game in betting phase
    const game = client.raceGames.get(channelId);
    if (!game) {
        return await interaction.reply({
            embeds: [errorEmbed('No active race in this channel. Use `/race start` to begin a new race.')],
            ephemeral: true
        });
    }
    if (game.phase !== 'betting') {
        return await interaction.reply({
            embeds: [errorEmbed('Betting is closed for this race. Please wait for it to finish.')],
            ephemeral: true
        });
    }

    if (horseNumber < 1 || horseNumber > 8) {
        return await interaction.reply({ embeds: [errorEmbed(`Horse number must be between 1 and 8!`)], ephemeral: true });
    }

    const existingBet = game.bets.find(b => b.userId === user.id);
    if (existingBet) {
        const existingHorse = game.horses[existingBet.horseIndex];
        return await interaction.reply({
            embeds: [errorEmbed(`You already bet on Horse ${existingHorse.number} (${existingHorse.name})! You can only place one bet per race.`)],
            ephemeral: true
        });
    }

    const bet = Number(await parseBet(betAmountStr, user.id));
    if (isNaN(bet)) {
        return await interaction.reply({ embeds: [errorEmbed(`You must bet a valid amount of ${CURRENCY_NAME}!`)], ephemeral: true });
    }
    if (bet % 1 !== 0) {
        return await interaction.reply({ embeds: [errorEmbed(`You must bet a whole number of ${CURRENCY_NAME}!`)], ephemeral: true });
    }
    if (RACE_MIN_BET && bet < RACE_MIN_BET) {
        return await interaction.reply({ embeds: [errorEmbed(`Minimum bet is ${RACE_MIN_BET} ${CURRENCY_NAME}!`)], ephemeral: true });
    }
    if (RACE_MAX_BET && bet > RACE_MAX_BET) {
        return await interaction.reply({ embeds: [errorEmbed(`Maximum bet is ${RACE_MAX_BET} ${CURRENCY_NAME}!`)], ephemeral: true });
    }

    let dbUser = await db.get(user.id);
    if (!dbUser) {
        logger.warn(`No database entry for user ${user.username} (${user.id}), creating one...`);
        await addNewDBUser(user);
    }

    const currentBalance = await db.get(`${user.id}.balance`) || 0;
    if (bet > currentBalance) {
        const embed = new EmbedBuilder()
            .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setColor(0xFF0000)
            .setDescription(`Insufficient funds! You have **${currentBalance}** ${CURRENCY_NAME}.`)
            .setTimestamp();
        return await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    await db.sub(`${user.id}.balance`, bet);
    await db.add(`${user.id}.stats.race.totalBet`, bet);

    // Find horse by number (array is shuffled, so index != number - 1)
    const horseIndex = game.horses.findIndex(h => h.number === horseNumber);
    const horse = game.horses[horseIndex];

    logger.log(`${user.username} (${user.id}) bet ${bet} ${CURRENCY_NAME} on Horse ${horseNumber} (${horse.name}) - ${betType}`);

    const betObj = {
        userId: user.id,
        username: user.displayName,
        horseIndex: horseIndex,
        amount: bet,
        odds: horse.displayOdds,
        betType: betType
    };
    game.bets.push(betObj);

    game.endTime = Date.now() + BETTING_TIME;
    if (game.collector) {
        game.collector.resetTimer();
    }

    try {
        const gameMessage = await interaction.channel.messages.fetch(game.messageId);
        const betsDescription = buildBettingDescription(game.horses, game.bets, game.endTime);
        const embed = new EmbedBuilder()
            .setAuthor({ name: `🏇 Horse Race`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
            .setTitle('🏇 Place Your Bets! 🏇')
            .setDescription(betsDescription)
            .setColor(randomHexColor())
            .setFooter({ text: `Betting closes in ${BETTING_TIME / 1000}s • Use /race bet to wager`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();
        await gameMessage.edit({ embeds: [embed] });
    } catch (e) {
        logger.error(`Error updating race message: ${e.message}`);
    }

    const confirmEmbed = new EmbedBuilder()
        .setAuthor({ name: 'Bet Placed!', iconURL: user.displayAvatarURL({ dynamic: true }) })
        .setDescription([
            `You bet **${bet}** ${CURRENCY_NAME} on:`,
            `**Horse ${horse.number}: ${horse.name}** ${horse.emoji}`,
            `**Odds:** ${horse.displayOdds}x`,
            `**Bet Type:** ${betType.charAt(0).toUpperCase() + betType.slice(1)}`,
            `**Potential win:** ${calculatePayout(bet, horse.displayOdds, HOUSE_EDGE, betType)} ${CURRENCY_NAME}`
        ].join('\n'))
        .setColor(randomHexColor())
        .setTimestamp();

    await interaction.reply({ embeds: [confirmEmbed], ephemeral: true });
}

async function resolveRace(client, channel, message, game) {
    game.phase = 'racing';

    await message.edit({ components: [] }).catch(() => {});

    const horses = game.horses;
    const positions = new Array(8).fill(0);
    let finishOrder = [];

    if (game.bets.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('Race Cancelled')
            .setDescription('No bets were placed. The race has been cancelled.')
            .setColor(0xFFAA00)
            .setTimestamp();
        await message.edit({ embeds: [embed] });
        client.raceGames.delete(game.channelId);
        return;
    }

    const embed = new EmbedBuilder()
        .setAuthor({ name: `Horse Race`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
        .setColor(randomHexColor())
        .setTimestamp();

    for (let tick = 1; tick <= ANIMATION_TICKS; tick++) {
        const result = advanceRace(horses, positions, game.topThree);

        for (const idx of result.newFinishers) {
            if (!finishOrder.includes(idx)) {
                finishOrder.push(idx);
            }
        }

        const description = buildRaceDescription(horses, positions, tick, ANIMATION_TICKS, null, finishOrder, game.topThree);
        const commentary = buildRaceTitle(game.commentary, tick, ANIMATION_TICKS, horses, positions, null, finishOrder);
        embed.setTitle(commentary);
        embed.setDescription(description);

        await message.edit({ embeds: [embed] });
        await wait(TICK_INTERVAL);
    }

    // Force top 3 into correct finish order
    const topThreeIndices = [game.topThree.firstIndex, game.topThree.secondIndex, game.topThree.thirdIndex];
    for (const idx of topThreeIndices) {
        if (!finishOrder.includes(idx)) {
            finishOrder.push(idx);
        }
    }
    // Remove top 3 and re-insert in correct order at the front
    finishOrder = finishOrder.filter(idx => !topThreeIndices.includes(idx));
    finishOrder.unshift(game.topThree.thirdIndex);
    finishOrder.unshift(game.topThree.secondIndex);
    finishOrder.unshift(game.topThree.firstIndex);

    // Add remaining unfinished horses by progress
    const unfinishedHorses = horses
        .map((_, i) => ({ i, progress: positions[i] }))
        .filter(h => !finishOrder.includes(h.i))
        .sort((a, b) => b.progress - a.progress);

    for (const h of unfinishedHorses) {
        finishOrder.push(h.i);
    }

    for (let i = 0; i < positions.length; i++) {
        positions[i] = 100;
    }

    const winner = horses[game.topThree.firstIndex];
    const secondPlace = horses[game.topThree.secondIndex];
    const thirdPlace = horses[game.topThree.thirdIndex];
    const finalDescription = buildRaceDescription(horses, positions, ANIMATION_TICKS, ANIMATION_TICKS, game.topThree.firstIndex, finishOrder);
    const finishCommentary = buildRaceTitle(game.commentary, ANIMATION_TICKS, ANIMATION_TICKS, horses, positions, game.topThree.firstIndex, finishOrder);

    const results = [];
    for (const bet of game.bets) {
        const horsePosition = finishOrder.indexOf(bet.horseIndex);
        const betType = bet.betType || 'win';
        let won = false;

        // Determine win based on bet type
        if (betType === 'win') {
            won = horsePosition === 0;
        } else if (betType === 'place') {
            won = horsePosition === 0 || horsePosition === 1;
        } else if (betType === 'show') {
            won = horsePosition === 0 || horsePosition === 1 || horsePosition === 2;
        }

        let winnings = 0;

        if (won) {
            winnings = calculatePayout(bet.amount, bet.odds, HOUSE_EDGE, betType);
            await db.add(`${bet.userId}.balance`, winnings);
            await db.add(`${bet.userId}.stats.race.wins`, 1);

            if (betType === 'place') {
                await db.add(`${bet.userId}.stats.race.placeWins`, 1);
            } else if (betType === 'show') {
                await db.add(`${bet.userId}.stats.race.showWins`, 1);
            }

            const biggestWin = await db.get(`${bet.userId}.stats.race.biggestWin`) || 0;
            if (winnings > biggestWin) {
                await db.set(`${bet.userId}.stats.race.biggestWin`, winnings);
            }
        } else {
            await db.add(`${bet.userId}.stats.race.losses`, 1);

            const biggestLoss = await db.get(`${bet.userId}.stats.race.biggestLoss`) || 0;
            if (bet.amount > biggestLoss) {
                await db.set(`${bet.userId}.stats.race.biggestLoss`, bet.amount);
            }
        }

        results.push({
            ...bet,
            won,
            winnings,
            horsePosition,
            newBalance: await db.get(`${bet.userId}.balance`)
        });
    }

    const totalWagered = game.bets.reduce((sum, b) => sum + b.amount, 0);
    const totalPaid = results.filter(r => r.won).reduce((sum, r) => sum + r.winnings, 0);

    const resultsLines = [
        `**${finishCommentary}**`,
        '',
        `🥇 **WINNER: Horse ${winner.number} — ${winner.name}** ${winner.emoji} [${winner.displayOdds}x]`,
        `🥈 **2nd: Horse ${secondPlace.number} — ${secondPlace.name}** ${secondPlace.emoji} [${secondPlace.displayOdds}x]`,
        `🥉 **3rd: Horse ${thirdPlace.number} — ${thirdPlace.name}** ${thirdPlace.emoji} [${thirdPlace.displayOdds}x]`,
        '',
        '```',
        finalDescription,
        '```',
        '',
        `**Total wagered:** ${totalWagered} ${CURRENCY_NAME}`,
        `**Total paid:** ${totalPaid} ${CURRENCY_NAME}`
    ];

    // Add participant results
    if (results.length > 0) {
        resultsLines.push('');
        resultsLines.push('**Results:**');
        const sorted = [...results].sort((a, b) => {
            if (a.won && !b.won) return -1;
            if (!a.won && b.won) return 1;
            return b.winnings - a.winnings;
        });
        for (const result of sorted) {
            const horse = horses[result.horseIndex];
            const betTypeLabel = (result.betType || 'win').charAt(0).toUpperCase() + (result.betType || 'win').slice(1);
            const positionLabel = result.horsePosition === 0 ? '🥇' : (result.horsePosition === 1 ? '🥈' : (result.horsePosition === 2 ? '🥉' : ''));
            if (result.won) {
                resultsLines.push(`${positionLabel}✅ <@${result.userId}> won **${result.winnings}** ${CURRENCY_NAME} on Horse ${horse.number} (${betTypeLabel})!`);
            } else {
                resultsLines.push(`❌ <@${result.userId}> lost **${result.amount}** ${CURRENCY_NAME} on Horse ${horse.number} (${betTypeLabel})`);
            }
        }
    }

    embed.setTitle('🏁 Race Results 🏁');
    embed.setDescription(resultsLines.join('\n'));
    embed.setColor(winner.displayOdds < 5 ? 0x00AA00 : (winner.displayOdds < 10 ? 0xFFAA00 : 0xFF0000));

    await message.edit({ embeds: [embed] });

    // Send DM to each participant
    for (const result of results) {
        try {
            const dmUser = await client.users.fetch(result.userId);
            const net = result.won ? result.winnings : -result.amount;
            const horse = horses[result.horseIndex];
            const betTypeLabel = (result.betType || 'win').charAt(0).toUpperCase() + (result.betType || 'win').slice(1);
            const positionText = result.horsePosition === 0 ? '1st 🥇' : (result.horsePosition === 1 ? '2nd 🥈' : (result.horsePosition === 2 ? '3rd 🥉' : `${result.horsePosition + 1}th`));

            const dmEmbed = new EmbedBuilder()
                .setTitle(result.won ? '🎉 You Won!' : '😔 You Lost')
                .setDescription([
                    `**Horse:** ${horse.number}. ${horse.name} ${horse.emoji}`,
                    `**Odds:** ${horse.displayOdds}x`,
                    `**Bet:** ${result.amount} ${CURRENCY_NAME}`,
                    `**Bet Type:** ${betTypeLabel}`,
                    `**Finish:** ${positionText}`,
                    `**Result:** ${result.won ? 'Won!' : 'Lost'}`,
                    '',
                    `**Net:** ${net >= 0 ? '+' : ''}${net} ${CURRENCY_NAME}`,
                    `**New balance:** ${result.newBalance} ${CURRENCY_NAME}`
                ].join('\n'))
                .setColor(result.won ? 0x00AA00 : 0xFF0000)
                .setTimestamp();

            await dmUser.send({ embeds: [dmEmbed] });
        } catch (e) {
            // DM failed, user may have DMs disabled
            logger.debug(`Could not send DM to user ${result.userId}: ${e.message}`);
        }
    }

    // Clean up
    client.raceGames.delete(game.channelId);
    logger.log(`Race in channel ${game.channelId} completed. Top 3: ${winner.number} (${winner.name}), ${secondPlace.number} (${secondPlace.name}), ${thirdPlace.number} (${thirdPlace.name}). Bets: ${game.bets.length}, Wagered: ${totalWagered}, Paid: ${totalPaid}`);
}