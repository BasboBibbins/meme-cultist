const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { addNewDBUser, setDBValue, db } = require("../../database");
const { CURRENCY_NAME, BLACKJACK_MAX_HANDS } = require("../../config.js");
const { parseBet } = require('../../utils/betparse');
const wait = require('node:timers/promises').setTimeout;
const { getHandValue, statusFromValue, checkHand, canSplit, isAcePair } = require('../../utils/blackjack');
const { newDeck, drawCard } = require('../../utils/cards');
const { canvasBlackjack } = require('../../utils/blackjackCanvas');
const { getEquippedTheme } = require('../../themes/manager');
const { getBlackjackColors } = require('../../themes/resolver');
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
            await addNewDBUser(user);
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

        // Shared embed used throughout the game — mutated by each phase
        const embed = new EmbedBuilder()
            .setAuthor({ name: `${user.displayName}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        // Game state for splits
        let hands = []; // Array of { cards: [], bet: number, isSplitAces: boolean, isDoubled: boolean }
        let dealerCards = [];
        let currentHandIndex = 0;
        let totalBets = 0; // Track total bets placed (original + splits + doubles)

        // Resolve theme for canvas rendering
        const themeId = await getEquippedTheme(user.id);
        const colors = getBlackjackColors(themeId);

        // Create deck and deal initial cards
        const deckId = await newDeck();
        let initialCards = [];
        for (let i = 0; i < 2; i++) {
            dealerCards.push(await drawCard(deckId));
            initialCards.push(await drawCard(deckId));
        }
        hands.push({ cards: initialCards, bet: originalBet, isSplitAces: false, isDoubled: false });
        totalBets = originalBet;

        // Deduct initial bet
        await db.sub(`${user.id}.balance`, originalBet);

        logger.debug(`Dealer: ${dealerCards[0].name} ${dealerCards[1].name} = ${dealerCards[0].numericValue + dealerCards[1].numericValue}`);
        logger.debug(`${user.username}: ${initialCards[0].name} ${initialCards[1].name} = ${initialCards[0].numericValue + initialCards[1].numericValue}`);

        // Helper: render current state to canvas and attach to embed
        async function renderState(revealHole = false, activeIndex = 0, title = 'Good luck!', description = '', outcomes = [], dealerOutcome = null, playerOutcome = null) {
            const attachment = await canvasBlackjack(dealerCards, hands, colors, themeId, revealHole, activeIndex, { user, dealerUser: interaction.client.user, outcomes, dealerOutcome, playerOutcome });
            if (attachment) {
                embed.setImage('attachment://blackjack.png');
            }
            embed.setTitle(title);
            if (description) embed.setDescription(description);
            return attachment;
        }

        // Check for natural blackjack
        if (checkHand(initialCards) === 'blackjack') {
            const dealerTotal = getHandValue(dealerCards);
            const naturalOutcome = dealerTotal === 21 ? 'push' : 'win';
            const dealerOutcome = dealerTotal === 21 ? 'push' : 'loss';
            const attachment = await renderState(true, 0, 'Blackjack!', '', [naturalOutcome], dealerOutcome, naturalOutcome);
            if (dealerTotal === 21) {
                // Push - both have natural blackjack
                await db.add(`${stats}.ties`, 1);
                await db.add(`${user.id}.balance`, originalBet);
                embed.setColor(0xFFFF00)
                    .setDescription(`Both have blackjack! It's a push!\nYour balance is **${(await db.get(`${user.id}.balance`)).toLocaleString('en-US')}** ${CURRENCY_NAME}.`);
                return await interaction.editReply({ embeds: [embed], components: [], files: [attachment] });
            }
            let winnings = originalBet + Math.ceil(originalBet * 1.5);
            await db.add(`${user.id}.balance`, winnings);
            await db.add(`${stats}.wins`, 1);
            await db.add(`${stats}.blackjacks`, 1);
            if (winnings > await db.get(`${stats}.biggestWin`)) await db.set(`${stats}.biggestWin`, winnings);
            await db.add(`${stats}.profit`, winnings - originalBet);
            embed.setColor(0x00AE86)
                .setDescription(`You got blackjack! You win **${(originalBet * 1.5).toLocaleString('en-US')}** ${CURRENCY_NAME}!\nYour new balance is **${(await db.get(`${user.id}.balance`)).toLocaleString('en-US')}** ${CURRENCY_NAME}.`)
                .setFooter({ text: `Bet: ${originalBet.toLocaleString('en-US')} ${CURRENCY_NAME} | ${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) });
            return await interaction.editReply({ embeds: [embed], components: [], files: [attachment] });
        }

        // Dealer peeks for natural blackjack (standard timing for late surrender).
        // Player blackjack was handled above, so any dealer blackjack here is a loss.
        if (checkHand(dealerCards) === 'blackjack') {
            await db.add(`${stats}.losses`, 1);
            await db.add(`${stats}.profit`, -originalBet);
            const biggestLoss = await db.get(`${stats}.biggestLoss`) || 0;
            if (originalBet > biggestLoss) await db.set(`${stats}.biggestLoss`, originalBet);
            const dealerTotal = getHandValue(dealerCards);
            const attachment = await renderState(true, 0, 'Dealer Blackjack!', '', ['loss'], 'win', 'loss');
            embed.setColor(0xFF0000)
                .setDescription(`Dealer has blackjack! You lose **${originalBet.toLocaleString('en-US')}** ${CURRENCY_NAME}.\nYour balance is **${(await db.get(`${user.id}.balance`)).toLocaleString('en-US')}** ${CURRENCY_NAME}.`)
                .setFooter({ text: `Bet: ${originalBet.toLocaleString('en-US')} ${CURRENCY_NAME} | ${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) });
            return await interaction.editReply({ embeds: [embed], components: [], files: [attachment] });
        }

        // Late-surrender window (seconds) — forfeit button auto-expires after this if the player doesn't act.
        const FORFEIT_WINDOW_MS = 10000;

        const statusTag = (status) => status === 'bust' ? ' 💥' : status === 'blackjack' ? ' 🃏' : '';

        // Main game loop - play through each hand
        async function playHands() {
            while (currentHandIndex < hands.length) {
                const currentHand = hands[currentHandIndex];
                const balance = await db.get(`${user.id}.balance`);
                const hasTwo = currentHand.cards.length === 2;
                const canAffordBet = balance >= currentHand.bet;

                const canSplitThisHand = hasTwo &&
                    canSplit(currentHand.cards) &&
                    hands.length < MAX_HANDS &&
                    !currentHand.isSplitAces &&
                    canAffordBet;

                const canDouble = hasTwo && !currentHand.isDoubled && canAffordBet;

                // Late surrender: only offered on the initial, untouched, unsplit hand (standard casino rule).
                const canForfeit = hands.length === 1 && hasTwo && !currentHand.isDoubled;

                const result = await playHand(currentHand, currentHandIndex, canSplitThisHand, canDouble, canForfeit);
                if (result === 'forfeit') return; // Player surrendered — game over, no dealer turn.
                currentHandIndex++;
            }

            // All hands played, dealer's turn
            await playDealer();
        }

        async function playHand(hand, handIndex, splitEnabled, canDouble, canForfeit = false) {
            return new Promise(async (resolve) => {
                embed.setColor(randomHexColor());
                embed.setFooter({ text: `Bet: ${hand.bet.toLocaleString('en-US')} ${CURRENCY_NAME} | ${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) });

                const title = hands.length > 1 ? `Hand ${handIndex + 1} of ${hands.length}` : `Good luck!`;
                const attachment = await renderState(false, handIndex, title);

                // Split aces: one card only, auto-stand
                if (hand.isSplitAces) {
                    await interaction.editReply({ embeds: [embed], components: [], files: attachment ? [attachment] : [] });
                    await wait(1000);
                    resolve(statusFromValue(getHandValue(hand.cards)) === 'bust' ? 'bust' : 'stand');
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
                    .setDisabled(!splitEnabled);

                if (splitEnabled || hands.length > 1) {
                    buttonRow.addComponents(splitButton);
                }

                // Late surrender: offered only on the initial untouched hand. Auto-expires after FORFEIT_WINDOW_MS.
                const forfeitButton = new ButtonBuilder()
                    .setCustomId('forfeit')
                    .setLabel('Forfeit')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🏳')
                    .setDisabled(!canForfeit);

                if (canForfeit) {
                    buttonRow.addComponents(forfeitButton);
                }

                let msg = await interaction.editReply({ embeds: [embed], components: [buttonRow], files: attachment ? [attachment] : [] });

                // Disables every action button except hit/stand
                const disableAdvancedActions = () => {
                    for (const btn of buttonRow.components) {
                        const id = btn.data?.custom_id;
                        if (id !== 'hit' && id !== 'stand') {
                            btn.setDisabled(true);
                        }
                    }
                };

                // Forfeit inactivity timer
                let forfeitTimer = null;
                if (canForfeit) {
                    forfeitTimer = setTimeout(async () => {
                        const forfeitBtn = buttonRow.components.find(b => b.data?.custom_id === 'forfeit');
                        if (forfeitBtn && !forfeitBtn.data.disabled) {
                            forfeitBtn.setDisabled(true);
                            try { await msg.edit({ embeds: [embed], components: [buttonRow], files: attachment ? [attachment] : [] }); } catch (_) {}
                        }
                    }, FORFEIT_WINDOW_MS);
                }

                const filter = i => i.user.id === user.id;
                const collector = msg.createMessageComponentCollector({ filter, time: 60000 });

                collector.on('collect', async i => {
                    if (forfeitTimer) { clearTimeout(forfeitTimer); forfeitTimer = null; }

                    if (i.customId === 'hit') {
                        hand.cards.push(await drawCard(deckId));
                        const newVal = getHandValue(hand.cards);
                        const handStatus = statusFromValue(newVal);
                        logger.debug(`${user.username} Hand ${handIndex + 1}: ${hand.cards.map(c => c.name).join(' ')} = ${newVal}`);

                        if (handStatus === 'bust') {
                            const title = hands.length > 1 ? `Hand ${handIndex + 1} — Bust! (${newVal})` : `Bust! (${newVal})`;
                            const att = await renderState(false, handIndex, title);
                            embed.setColor(0xFF0000);
                            await i.update({ embeds: [embed], components: [], files: att ? [att] : [] });
                            collector.stop('bust');
                        } else if (handStatus === 'blackjack') {
                            const title = hands.length > 1 ? `Hand ${handIndex + 1} — 21!` : `21!`;
                            const att = await renderState(false, handIndex, title);
                            embed.setColor(0x00AE86);
                            await i.update({ embeds: [embed], components: [], files: att ? [att] : [] });
                            collector.stop('blackjack');
                        } else {
                            disableAdvancedActions();
                            const att = await renderState(false, handIndex, title);
                            await i.update({ embeds: [embed], components: [buttonRow], files: att ? [att] : [] });
                        }
                    } else if (i.customId === 'stand') {
                        const standVal = getHandValue(hand.cards);
                        const stTitle = hands.length > 1 ? `Hand ${handIndex + 1} — Stand (${standVal})` : `Stand (${standVal})`;
                        const att = await renderState(false, handIndex, stTitle);
                        await i.update({ embeds: [embed], components: [], files: att ? [att] : [] });
                        collector.stop('stand');
                    } else if (i.customId === 'double') {
                        await db.sub(`${user.id}.balance`, hand.bet);
                        totalBets += hand.bet;
                        hand.bet *= 2;
                        hand.isDoubled = true;

                        hand.cards.push(await drawCard(deckId));
                        const newVal = getHandValue(hand.cards);
                        const doubleStatus = statusFromValue(newVal);
                        logger.debug(`${user.username} Hand ${handIndex + 1} doubled: ${hand.cards.map(c => c.name).join(' ')} = ${newVal}`);

                        const dTitle = doubleStatus === 'bust'
                            ? (hands.length > 1 ? `Hand ${handIndex + 1} — Double Down — Bust! (${newVal})` : `Double Down — Bust! (${newVal})`)
                            : (hands.length > 1 ? `Hand ${handIndex + 1} — Double Down (${newVal})` : `Double Down (${newVal})`);
                        const att = await renderState(false, handIndex, dTitle);
                        if (doubleStatus === 'bust') embed.setColor(0xFF0000);
                        embed.setFooter({ text: `Bet: ${hand.bet.toLocaleString('en-US')} ${CURRENCY_NAME} | ${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) });
                        await i.update({ embeds: [embed], components: [], files: att ? [att] : [] });
                        collector.stop(doubleStatus === 'bust' ? 'bust' : doubleStatus === 'blackjack' ? 'blackjack' : 'stand');
                    } else if (i.customId === 'split') {
                        await db.sub(`${user.id}.balance`, hand.bet);
                        totalBets += hand.bet;

                        const wasAcePair = isAcePair(hand.cards);
                        const splitCard = hand.cards[1];
                        hand.cards = [hand.cards[0], await drawCard(deckId)];
                        const newHand = {
                            cards: [splitCard, await drawCard(deckId)],
                            bet: hand.bet,
                            isSplitAces: wasAcePair,
                            isDoubled: false
                        };
                        hand.isSplitAces = wasAcePair;

                        hands.splice(handIndex + 1, 0, newHand);
                        logger.debug(`${user.username} split hand ${handIndex + 1}. Now ${hands.length} hands.`);

                        const att = await renderState(false, handIndex, `Split! (${hands.length} hands)`);
                        await i.update({ embeds: [embed], components: [], files: att ? [att] : [] });
                        collector.stop('split');
                    } else if (i.customId === 'forfeit') {
                        const refund = Math.floor(hand.bet / 2);
                        const netLoss = hand.bet - refund;
                        await db.add(`${user.id}.balance`, refund);
                        await db.add(`${stats}.losses`, 1);
                        await db.add(`${stats}.surrenders`, 1);
                        await db.add(`${stats}.profit`, -netLoss);
                        const biggestLoss = await db.get(`${stats}.biggestLoss`) || 0;
                        if (netLoss > biggestLoss) await db.set(`${stats}.biggestLoss`, netLoss);

                        const att = await renderState(true, handIndex, 'Forfeit',
                            `You forfeited your hand and recovered **${refund.toLocaleString('en-US')}** ${CURRENCY_NAME}.\nYour balance is **${(await db.get(`${user.id}.balance`)).toLocaleString('en-US')}** ${CURRENCY_NAME}.`);
                        embed.setColor(0xAAAAAA);
                        embed.setFooter({ text: `Bet: ${hand.bet.toLocaleString('en-US')} ${CURRENCY_NAME} (forfeited) | ${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) });
                        await i.update({ embeds: [embed], components: [], files: att ? [att] : [] });
                        logger.info(`${user.username}(${user.id}) forfeited their hand, recovering ${refund} ${CURRENCY_NAME}.`);
                        collector.stop('forfeit');
                    }
                });

                collector.on('end', async (collected, reason) => {
                    if (forfeitTimer) { clearTimeout(forfeitTimer); forfeitTimer = null; }
                    logger.debug(`Hand ${handIndex + 1} collector ended. Reason: ${reason}`);

                    if (hands.length > 1 && ['bust', 'blackjack', 'stand', 'double'].includes(reason)) {
                        await wait(1500);
                    }

                    if (reason === 'bust' || reason === 'blackjack' || reason === 'stand' || reason === 'forfeit') {
                        resolve(reason);
                    } else if (reason === 'split') {
                        const balance = await db.get(`${user.id}.balance`);
                        const hasTwo = hand.cards.length === 2;
                        const canAffordBet = balance >= hand.bet;
                        const canSplitThisHand = hasTwo && canSplit(hand.cards) &&
                            hands.length < MAX_HANDS && !hand.isSplitAces && canAffordBet;
                        const canDoubleHand = hasTwo && !hand.isDoubled && canAffordBet;
                        resolve(await playHand(hand, handIndex, canSplitThisHand, canDoubleHand));
                    } else {
                        resolve('stand');
                    }
                });
            });
        }

        async function playDealer() {
            embed.setColor(randomHexColor());
            embed.setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) });

            // Reveal hole card and show dealer's turn start
            let attachment = await renderState(true, 0, `Dealer's turn`);
            await interaction.editReply({ embeds: [embed], components: [], files: attachment ? [attachment] : [] });
            await wait(1000);

            // Dealer draws until hard 17+
            let dealerTotal = getHandValue(dealerCards);
            while (dealerTotal < 17) {
                dealerCards.push(await drawCard(deckId));
                dealerTotal = getHandValue(dealerCards);
                attachment = await renderState(true, 0, `Dealer's turn`);
                await interaction.editReply({ embeds: [embed], components: [], files: attachment ? [attachment] : [] });
                await wait(1000);
            }

            const dealerStatus = statusFromValue(dealerTotal);
            logger.debug(`Dealer: ${dealerCards.map(c => c.name).join(' ')} = ${dealerTotal}`);

            let totalWinnings = 0;
            let biggestHandLoss = 0;
            let resultLines = [];
            const outcomes = [];

            for (let i = 0; i < hands.length; i++) {
                const hand = hands[i];
                const handTotal = getHandValue(hand.cards);
                const handStatus = statusFromValue(handTotal);

                let handResult = '';
                let winnings = 0;

                if (handStatus === 'bust') {
                    handResult = 'BUST';
                    if (hand.bet > biggestHandLoss) biggestHandLoss = hand.bet;
                    await db.add(`${stats}.losses`, 1);
                } else if (dealerStatus === 'bust') {
                    winnings = hand.bet * 2;
                    handResult = 'WIN';
                    totalWinnings += winnings;
                    await db.add(`${stats}.wins`, 1);
                } else if (handTotal > dealerTotal) {
                    winnings = hand.bet * 2;
                    handResult = 'WIN';
                    totalWinnings += winnings;
                    await db.add(`${stats}.wins`, 1);
                } else if (handTotal < dealerTotal) {
                    handResult = 'LOSE';
                    if (hand.bet > biggestHandLoss) biggestHandLoss = hand.bet;
                    await db.add(`${stats}.losses`, 1);
                } else {
                    winnings = hand.bet;
                    handResult = 'PUSH';
                    totalWinnings += winnings;
                    await db.add(`${stats}.ties`, 1);
                }

                outcomes.push(handResult === 'WIN' ? 'win' : handResult === 'PUSH' ? 'push' : 'loss');

                const marker = hand.isDoubled ? ' 💵' : '';
                const tag = statusTag(handStatus);
                const label = hands.length > 1 ? `Hand ${i + 1}:` : `Your hand:`;
                resultLines.push(`**${label}** (${handTotal})${marker}${tag} → ${handResult}${winnings > 0 ? ` (+${winnings.toLocaleString('en-US')})` : ''}`);
            }

            if (totalWinnings > 0) {
                await db.add(`${user.id}.balance`, totalWinnings);
                const profit = totalWinnings - totalBets;
                if (profit > 0) {
                    const biggestWin = await db.get(`${stats}.biggestWin`) || 0;
                    if (profit > biggestWin) {
                        await db.set(`${stats}.biggestWin`, profit);
                    }
                }
            }

            if (biggestHandLoss > 0) {
                const biggestLoss = await db.get(`${stats}.biggestLoss`) || 0;
                if (biggestHandLoss > biggestLoss) {
                    await db.set(`${stats}.biggestLoss`, biggestHandLoss);
                }
            }

            const netProfit = totalWinnings - totalBets;
            await db.add(`${stats}.profit`, netProfit);

            const dTitle = dealerStatus === 'bust' ? 'Dealer busts!' : `Dealer: ${dealerTotal}`;
            const desc = `${resultLines.join('\n')}\n\n${totalWinnings > totalBets ? `You won **${(totalWinnings - totalBets).toLocaleString('en-US')}** ${CURRENCY_NAME}!` : totalWinnings === totalBets ? `You broke even.` : `You lost **${(totalBets - totalWinnings).toLocaleString('en-US')}** ${CURRENCY_NAME}.`}\nYour balance is **${(await db.get(`${user.id}.balance`)).toLocaleString('en-US')}** ${CURRENCY_NAME}.`;
            const allWin = outcomes.length > 0 && outcomes.every(o => o === 'win');
            const allLoss = outcomes.length > 0 && outcomes.every(o => o === 'loss');
            const allPush = outcomes.length > 0 && outcomes.every(o => o === 'push');
            const dealerOutcome = allLoss ? 'win' : allWin ? 'loss' : allPush ? 'push' : null;
            const playerOutcome = allWin ? 'win' : allLoss ? 'loss' : allPush ? 'push' : null;
            attachment = await renderState(true, 0, dTitle, desc, outcomes, dealerOutcome, playerOutcome);
            embed.setColor(totalWinnings > totalBets ? 0x00AE86 : (totalWinnings > 0 ? 0xFFFF00 : 0xFF0000));
            await interaction.editReply({ embeds: [embed], components: [], files: attachment ? [attachment] : [] });
        }

        // Start the game
        await playHands();
    }
};
