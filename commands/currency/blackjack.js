const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const { addNewDBUser, setDBValue } = require("../../database");
const { CURRENCY_NAME, BLACKJACK_MAX_HANDS } = require("../../config.js");
const { parseBet } = require('../../utils/betparse');
const wait = require('node:timers/promises').setTimeout;
const bj = require('../../utils/blackjack');
const logger = require("../../utils/logger");
const { randomHexColor } = require('../../utils/randomcolor');

const MAX_HANDS = BLACKJACK_MAX_HANDS || 4;

module.exports = {
    data: new SlashCommandBuilder()
        .setName("blackjack")
        .setDescription(`Play a game of blackjack for ${CURRENCY_NAME}.`)
        .addStringOption(option =>
            option.setName('bet')
                .setDescription(`The amount of ${CURRENCY_NAME} to bet.`)
                .setRequired(true)),
    async execute(interaction) {
        const user = interaction.user;
        const option = interaction.options.getString('bet');
        const stats = `${user.id}.stats.blackjack`;

        let originalBet = Number(await parseBet(option, user.id));
        const dbUser = await db.get(user.id);

        logger.info(`${user.username}(${user.id}) initialized a game of blackjack with a bet of ${originalBet} ${CURRENCY_NAME}.`)

        const error_embed = new EmbedBuilder()
            .setAuthor({ name: user.displayName , iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setColor(0xFF0000)
            .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        if (!dbUser) {
            await addNewDBUser(user.id);
            error_embed.setDescription(`You don't have an account! Please try using the \`daily\` command and then try again.`);
            return interaction.reply({ embeds: [error_embed], ephemeral: true });
        }
        if (originalBet > dbUser.balance) {
            error_embed.setDescription(`You don't have enough ${CURRENCY_NAME}!`);
            return interaction.reply({ embeds: [error_embed], ephemeral: true });
        }
        if (originalBet < 1) {
            error_embed.setDescription(`You must bet at least 1 ${CURRENCY_NAME}!`);
            return interaction.reply({ embeds: [error_embed], ephemeral: true });
        }
        if (originalBet % 1 !== 0) {
            error_embed.setDescription(`You must bet in whole numbers!`);
            return interaction.reply({ embeds: [error_embed], ephemeral: true });
        }

        await interaction.deferReply();

        // Game state for splits
        let hands = []; // Array of { cards: [], bet: number, isSplitAces: boolean, isDoubled: boolean }
        let dealerCards = [];
        let currentHandIndex = 0;
        let totalBets = 0; // Track total bets placed (original + splits + doubles)

        // Initialize first hand
        let initialCards = [];
        for (let i = 0; i < 2; i++) {
            dealerCards.push(await bj.dealCards());
            initialCards.push(await bj.dealCards());
        }
        hands.push({ cards: initialCards, bet: originalBet, isSplitAces: false, isDoubled: false });
        totalBets = originalBet;

        // Deduct initial bet
        await db.sub(`${user.id}.balance`, originalBet);

        logger.debug(`Dealer: ${dealerCards[0].name} ${dealerCards[1].name} = ${dealerCards[0].value + dealerCards[1].value}`);
        logger.debug(`${user.username}: ${initialCards[0].name} ${initialCards[1].name} = ${initialCards[0].value + initialCards[1].value}`);

        // Check for natural blackjack
        if (await bj.checkHand(initialCards) === 'blackjack') {
            let dealerTotal = await bj.getHandValue(dealerCards);
            if (dealerTotal === 21) {
                // Push - both have natural blackjack
                await db.add(`${stats}.ties`, 1);
                await db.add(`${user.id}.balance`, originalBet);
                const embed = new EmbedBuilder()
                    .setAuthor({ name: `${user.displayName}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                    .setTitle(`Push!`)
                    .setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.displayName}:**\n${initialCards.map(card => `\`${card.char}\``).join(' ')}\n\nBoth have blackjack! It's a push!\nYour balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`)
                    .setColor(0xFFFF00)
                    .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                    .setTimestamp();
                return await interaction.editReply({ embeds: [embed], components: [] });
            }
            let winnings = Math.ceil(originalBet * 1.5);
            await db.add(`${user.id}.balance`, winnings);
            await db.add(`${stats}.wins`, 1);
            await db.add(`${stats}.blackjacks`, 1);
            if (winnings > await db.get(`${stats}.blackjack.biggestWin`)) await db.set(`${stats}.blackjack.biggestWin`, winnings);
            const embed = new EmbedBuilder()
                .setAuthor({ name: `${user.displayName}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                .setTitle(`Blackjack!`)
                .setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')} (${dealerTotal})\n\n**${user.displayName}:**\n${initialCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou got blackjack! You win **${originalBet * 1.5}** ${CURRENCY_NAME}!\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`)
                .setColor(0x00AE86)
                .setFooter({ text: `Bet: ${originalBet} ${CURRENCY_NAME} | ${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();
            return await interaction.editReply({ embeds: [embed], components: [] });
        }

        // Build the hand description for embeds (dealer hole card hidden)
        async function buildDescription(activeHandIndex) {
            let desc = `**Dealer:**\n\`${dealerCards[0].char}\` \`??\`\n\n`;
            if (hands.length > 1) {
                for (let i = 0; i < hands.length; i++) {
                    const h = hands[i];
                    const val = await bj.getHandValue(h.cards);
                    const arrow = i === activeHandIndex ? '▶️ ' : '';
                    const marker = h.isDoubled ? ' 💵' : '';
                    const hStatus = await bj.checkHand(h.cards);
                    const tag = hStatus === 'bust' ? ' 💥' : hStatus === 'blackjack' ? ' 🃏' : '';
                    const label = hands.length > 1 ? `Hand ${i + 1}:` : `Your hand:`;
                    desc += `${arrow} **${label}** ${h.cards.map(c => `\`${c.char}\``).join(' ')} (${val})${marker}${tag}\n`;
                }
            } else {
                const val = await bj.getHandValue(hands[0].cards);
                const hStatus = await bj.checkHand(hands[0].cards);
                const marker = hands[0].isDoubled ? ' 💵' : '';
                const tag = hStatus === 'bust' ? ' 💥' : hStatus === 'blackjack' ? ' 🃏' : '';
                desc += `**Your hand:** ${hands[0].cards.map(c => `\`${c.char}\``).join(' ')} (${val})${marker}${tag}`;
            }
            return desc;
        }

        // Main game loop - play through each hand
        async function playHands() {
            while (currentHandIndex < hands.length) {
                const currentHand = hands[currentHandIndex];
                const canSplitThisHand = currentHand.cards.length === 2 &&
                    await bj.canSplit(currentHand.cards) &&
                    hands.length < MAX_HANDS &&
                    !currentHand.isSplitAces &&
                    (await db.get(`${user.id}.balance`)) >= currentHand.bet;

                const canDouble = currentHand.cards.length === 2 &&
                    !currentHand.isDoubled &&
                    (await db.get(`${user.id}.balance`)) >= currentHand.bet;

                const result = await playHand(currentHand, currentHandIndex, canSplitThisHand, canDouble);
                currentHandIndex++;
            }

            // All hands played, dealer's turn
            await playDealer();
        }

        async function playHand(hand, handIndex, canSplit, canDouble) {
            return new Promise(async (resolve) => {
                const embed = new EmbedBuilder()
                    .setAuthor({ name: `${user.displayName}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                    .setTitle(hands.length > 1 ? `Hand ${handIndex + 1} of ${hands.length}` : `Good luck!`)
                    .setColor(randomHexColor())
                    .setFooter({ text: `Bet: ${hand.bet} ${CURRENCY_NAME} | ${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                    .setTimestamp();

                embed.setDescription(await buildDescription(handIndex));

                // Split aces: one card only, auto-stand
                if (hand.isSplitAces) {
                    await interaction.editReply({ embeds: [embed], components: [] });
                    await wait(1000);
                    const handStatus = await bj.checkHand(hand.cards);
                    resolve(handStatus === 'bust' ? 'bust' : 'stand');
                    return;
                }

                const buttonRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('hit')
                            .setLabel('Hit')
                            .setStyle(ButtonStyle.Primary)
                            .setEmoji('☝'),
                        new ButtonBuilder()
                            .setCustomId('stand')
                            .setLabel('Stand')
                            .setStyle(ButtonStyle.Primary)
                            .setEmoji('✋'),
                        new ButtonBuilder()
                            .setCustomId('double')
                            .setLabel('Double Down')
                            .setStyle(ButtonStyle.Success)
                            .setEmoji('💵')
                            .setDisabled(!canDouble)
                    );

                // Add split button if conditions are met
                const splitButton = new ButtonBuilder()
                    .setCustomId('split')
                    .setLabel('Split')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('✂')
                    .setDisabled(!canSplit);

                if (canSplit || hands.length > 1) {
                    buttonRow.addComponents(splitButton);
                }

                let msg = await interaction.editReply({ embeds: [embed], components: [buttonRow] });

                const filter = i => i.user.id === user.id;
                const collector = msg.createMessageComponentCollector({ filter, time: 60000 });

                collector.on('collect', async i => {
                    if (i.customId === 'hit') {
                        hand.cards.push(await bj.dealCards());
                        const handStatus = await bj.checkHand(hand.cards);
                        const newVal = await bj.getHandValue(hand.cards);
                        logger.debug(`${user.username} Hand ${handIndex + 1}: ${hand.cards.map(c => c.name).join(' ')} = ${newVal}`);

                        // Always show the new card to the user
                        embed.setDescription(await buildDescription(handIndex));

                        if (handStatus === 'bust') {
                            embed.setTitle(hands.length > 1 ? `Hand ${handIndex + 1} — Bust! (${newVal})` : `Bust! (${newVal})`);
                            embed.setColor(0xFF0000);
                            await i.update({ embeds: [embed], components: [] });
                            collector.stop('bust');
                        } else if (handStatus === 'blackjack') {
                            embed.setTitle(hands.length > 1 ? `Hand ${handIndex + 1} — 21!` : `21!`);
                            embed.setColor(0x00AE86);
                            await i.update({ embeds: [embed], components: [] });
                            collector.stop('blackjack');
                        } else {
                            // Disable split and double after hitting
                            buttonRow.components[2].setDisabled(true); // double
                            if (buttonRow.components.length > 3) {
                                buttonRow.components[3].setDisabled(true); // split
                            }
                            await i.update({ embeds: [embed], components: [buttonRow] });
                        }
                    } else if (i.customId === 'stand') {
                        embed.setDescription(await buildDescription(handIndex));
                        embed.setTitle(hands.length > 1 ? `Hand ${handIndex + 1} — Stand (${await bj.getHandValue(hand.cards)})` : `Stand (${await bj.getHandValue(hand.cards)})`);
                        await i.update({ embeds: [embed], components: [] });
                        collector.stop('stand');
                    } else if (i.customId === 'double') {
                        await db.sub(`${user.id}.balance`, hand.bet);
                        totalBets += hand.bet;
                        hand.bet *= 2;
                        hand.isDoubled = true;

                        hand.cards.push(await bj.dealCards());
                        const newVal = await bj.getHandValue(hand.cards);
                        logger.debug(`${user.username} Hand ${handIndex + 1} doubled: ${hand.cards.map(c => c.name).join(' ')} = ${newVal}`);

                        // Show the doubled hand with the new card
                        embed.setDescription(await buildDescription(handIndex));
                        const doubleStatus = await bj.checkHand(hand.cards);
                        if (doubleStatus === 'bust') {
                            embed.setTitle(hands.length > 1 ? `Hand ${handIndex + 1} — Double Down — Bust! (${newVal})` : `Double Down — Bust! (${newVal})`);
                            embed.setColor(0xFF0000);
                        } else {
                            embed.setTitle(hands.length > 1 ? `Hand ${handIndex + 1} — Double Down (${newVal})` : `Double Down (${newVal})`);
                        }
                        embed.setFooter({ text: `Bet: ${hand.bet} ${CURRENCY_NAME} | ${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) });
                        await i.update({ embeds: [embed], components: [] });
                        collector.stop('double');
                    } else if (i.customId === 'split') {
                        // Split this hand
                        await db.sub(`${user.id}.balance`, hand.bet);
                        totalBets += hand.bet;

                        // Check if this is an ace pair BEFORE splitting
                        const wasAcePair = await bj.isAcePair(hand.cards);

                        // Get the split card and deal new cards to both hands
                        const splitCard = hand.cards[1];
                        hand.cards = [hand.cards[0], await bj.dealCards()];
                        const newHand = {
                            cards: [splitCard, await bj.dealCards()],
                            bet: hand.bet,
                            isSplitAces: wasAcePair,
                            isDoubled: false
                        };
                        hand.isSplitAces = wasAcePair;

                        hands.splice(handIndex + 1, 0, newHand);
                        logger.debug(`${user.username} split hand ${handIndex + 1}. Now ${hands.length} hands.`);

                        // Show the split result — both new hands
                        embed.setTitle(`Split! (${hands.length} hands)`);
                        embed.setDescription(await buildDescription(handIndex));
                        await i.update({ embeds: [embed], components: [] });
                        collector.stop('split');
                    }
                });

                collector.on('end', async (collected, reason) => {
                    logger.debug(`Hand ${handIndex + 1} collector ended. Reason: ${reason}`);

                    // Brief pause so the user can see the result before the next hand
                    if (hands.length > 1 && ['bust', 'blackjack', 'stand', 'double'].includes(reason)) {
                        await wait(1500);
                    }

                    if (reason === 'bust') {
                        resolve('bust');
                    } else if (reason === 'blackjack') {
                        resolve('blackjack');
                    } else if (reason === 'stand') {
                        resolve('stand');
                    } else if (reason === 'double') {
                        const handStatus = await bj.checkHand(hand.cards);
                        if (handStatus === 'bust') {
                            resolve('bust');
                        } else if (handStatus === 'blackjack') {
                            resolve('blackjack');
                        } else {
                            resolve('stand');
                        }
                    } else if (reason === 'split') {
                        // Recursively play the current hand again (it now has a new second card)
                        // Then the loop will continue to the next hand
                        const canSplitThisHand = hand.cards.length === 2 &&
                            await bj.canSplit(hand.cards) &&
                            hands.length < MAX_HANDS &&
                            !hand.isSplitAces &&
                            (await db.get(`${user.id}.balance`)) >= hand.bet;
                        const canDoubleHand = hand.cards.length === 2 &&
                            !hand.isDoubled &&
                            (await db.get(`${user.id}.balance`)) >= hand.bet;

                        const result = await playHand(hand, handIndex, canSplitThisHand, canDoubleHand);
                        resolve(result);
                    } else if (reason === 'time') {
                        // Timeout - auto-stand
                        resolve('stand');
                    } else {
                        resolve('stand');
                    }
                });
            });
        }

        async function playDealer() {
            // Helper to build dealer phase description
            async function buildDealerDescription() {
                const dealerVal = await bj.getHandValue(dealerCards);
                let desc = `**Dealer:**\n${dealerCards.map(c => `\`${c.char}\``).join(' ')} (${dealerVal})\n\n`;
                for (let i = 0; i < hands.length; i++) {
                    const h = hands[i];
                    const val = await bj.getHandValue(h.cards);
                    const marker = h.isDoubled ? ' 💵' : '';
                    const status = await bj.checkHand(h.cards);
                    const tag = status === 'bust' ? ' 💥' : status === 'blackjack' ? ' 🃏' : '';
                    const label = hands.length > 1 ? `Hand ${i + 1}:` : `Your hand:`;
                    desc += `**${label}** ${h.cards.map(c => `\`${c.char}\``).join(' ')} (${val})${marker}${tag}\n`;
                }
                return desc;
            }

            const dealerEmbed = new EmbedBuilder()
                .setAuthor({ name: `${user.displayName}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                .setTitle(`Dealer's turn`)
                .setColor(randomHexColor())
                .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();

            // Reveal hole card
            dealerEmbed.setDescription(await buildDealerDescription());
            await interaction.editReply({ embeds: [dealerEmbed], components: [] });
            await wait(1000);

            // Dealer draws one card at a time
            while (await bj.dealerChoice(dealerCards) === 'hit' && (await bj.checkHand(dealerCards) === 'safe')) {
                logger.debug(`Dealer choice is hit.`);
                dealerCards.push(await bj.dealCards());
                dealerEmbed.setDescription(await buildDealerDescription());
                await interaction.editReply({ embeds: [dealerEmbed], components: [] });
                await wait(1000);
            }

            const dealerTotal = await bj.getHandValue(dealerCards);
            const dealerStatus = await bj.checkHand(dealerCards);
            let finalDescription = `**Dealer:**\n${dealerCards.map(c => `\`${c.char}\``).join(' ')} (${dealerTotal})\n\n`;
            logger.debug(`Dealer: ${dealerCards.map(c => c.name).join(' ')} = ${dealerTotal}`);

            let totalWinnings = 0;
            let biggestHandLoss = 0;
            let resultLines = [];

            for (let i = 0; i < hands.length; i++) {
                const hand = hands[i];
                const handTotal = await bj.getHandValue(hand.cards);
                const handStatus = await bj.checkHand(hand.cards);

                let handResult = '';
                let winnings = 0;

                if (handStatus === 'bust') {
                    // Player already busted - lost
                    handResult = 'BUST';
                    if (hand.bet > biggestHandLoss) biggestHandLoss = hand.bet;
                    await db.add(`${stats}.losses`, 1);
                } else if (dealerStatus === 'bust') {
                    // Dealer busted - player wins
                    winnings = hand.bet * 2;
                    handResult = 'WIN';
                    totalWinnings += winnings;
                    await db.add(`${stats}.wins`, 1);
                } else if (handTotal > dealerTotal) {
                    // Player higher - wins
                    winnings = hand.bet * 2;
                    handResult = 'WIN';
                    totalWinnings += winnings;
                    await db.add(`${stats}.wins`, 1);
                } else if (handTotal < dealerTotal) {
                    // Dealer higher - loses
                    handResult = 'LOSE';
                    if (hand.bet > biggestHandLoss) biggestHandLoss = hand.bet;
                    await db.add(`${stats}.losses`, 1);
                } else {
                    // Tie - push
                    winnings = hand.bet;
                    handResult = 'PUSH';
                    totalWinnings += winnings;
                    await db.add(`${stats}.ties`, 1);
                }

                const marker = hand.isDoubled ? ' 💵' : '';
                const tag = handStatus === 'bust' ? ' 💥' : handStatus === 'blackjack' ? ' 🃏' : '';
                const label = hands.length > 1 ? `Hand ${i + 1}:` : `Your hand:`;
                resultLines.push(`**${label}** ${hand.cards.map(card => `\`${card.char}\``).join(' ')} (${handTotal})${marker}${tag} → ${handResult}${winnings > 0 ? ` (+${winnings})` : ''}`);
            }

            // Add winnings
            if (totalWinnings > 0) {
                await db.add(`${user.id}.balance`, totalWinnings);
                if (totalWinnings > await db.get(`${stats}.blackjack.biggestWin`)) {
                    await db.set(`${stats}.blackjack.biggestWin`, totalWinnings);
                }
            }

            // Update stats for biggest loss (only actual losses)
            if (biggestHandLoss > 0 && biggestHandLoss > await db.get(`${stats}.blackjack.biggestLoss`)) {
                await db.set(`${stats}.blackjack.biggestLoss`, biggestHandLoss);
            }

            const finalEmbed = new EmbedBuilder()
                .setAuthor({ name: `${user.displayName}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                .setTitle(dealerStatus === 'bust' ? 'Dealer busts!' : `Dealer: ${dealerTotal}`)
                .setDescription(`${finalDescription}${resultLines.join('\n')}\n\n${totalWinnings > totalBets ? `You won **${totalWinnings - totalBets}** ${CURRENCY_NAME}!` : totalWinnings === totalBets ? `You broke even.` : `You lost **${totalBets - totalWinnings}** ${CURRENCY_NAME}.`}\nYour balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`)
                .setColor(totalWinnings > totalBets ? 0x00AE86 : (totalWinnings > 0 ? 0xFFFF00 : 0xFF0000))
                .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();

            await interaction.editReply({ embeds: [finalEmbed], components: [] });
        }

        // Start the game
        await playHands();
    }
}