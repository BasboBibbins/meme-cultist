const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { addNewDBUser, setDBValue, db } = require("../../database");
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

        // Game state for splits
        let hands = []; // Array of { cards: [], bet: number, isSplitAces: boolean, isDoubled: boolean }
        let dealerCards = [];
        let currentHandIndex = 0;
        let totalBets = 0; // Track total bets placed (original + splits + doubles)

        // Initialize first hand
        let initialCards = [];
        for (let i = 0; i < 2; i++) {
            dealerCards.push(bj.dealCards());
            initialCards.push(bj.dealCards());
        }
        hands.push({ cards: initialCards, bet: originalBet, isSplitAces: false, isDoubled: false });
        totalBets = originalBet;

        // Deduct initial bet
        await db.sub(`${user.id}.balance`, originalBet);

        logger.debug(`Dealer: ${dealerCards[0].name} ${dealerCards[1].name} = ${dealerCards[0].value + dealerCards[1].value}`);
        logger.debug(`${user.username}: ${initialCards[0].name} ${initialCards[1].name} = ${initialCards[0].value + initialCards[1].value}`);

        // Check for natural blackjack
        if (bj.checkHand(initialCards) === 'blackjack') {
            const dealerTotal = bj.getHandValue(dealerCards);
            if (dealerTotal === 21) {
                // Push - both have natural blackjack
                await db.add(`${stats}.ties`, 1);
                await db.add(`${user.id}.balance`, originalBet);
                // Net 0 for a push, no profit change
                const embed = new EmbedBuilder()
                    .setAuthor({ name: `${user.displayName}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                    .setTitle(`Push!`)
                    .setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.displayName}:**\n${initialCards.map(card => `\`${card.char}\``).join(' ')}\n\nBoth have blackjack! It's a push!\nYour balance is **${(await db.get(`${user.id}.balance`)).toLocaleString('en-US')}** ${CURRENCY_NAME}.`)
                    .setColor(0xFFFF00)
                    .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                    .setTimestamp();
                return await interaction.editReply({ embeds: [embed], components: [] });
            }
            let winnings = originalBet + Math.ceil(originalBet * 1.5);
            await db.add(`${user.id}.balance`, winnings);
            await db.add(`${stats}.wins`, 1);
            await db.add(`${stats}.blackjacks`, 1);
            if (winnings > await db.get(`${stats}.biggestWin`)) await db.set(`${stats}.biggestWin`, winnings);
            await db.add(`${stats}.profit`, winnings - originalBet);
            const embed = new EmbedBuilder()
                .setAuthor({ name: `${user.displayName}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                .setTitle(`Blackjack!`)
                .setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')} (${dealerTotal})\n\n**${user.displayName}:**\n${initialCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou got blackjack! You win **${(originalBet * 1.5).toLocaleString('en-US')}** ${CURRENCY_NAME}!\nYour new balance is **${(await db.get(`${user.id}.balance`)).toLocaleString('en-US')}** ${CURRENCY_NAME}.`)
                .setColor(0x00AE86)
                .setFooter({ text: `Bet: ${originalBet.toLocaleString('en-US')} ${CURRENCY_NAME} | ${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();
            return await interaction.editReply({ embeds: [embed], components: [] });
        }

        // Dealer peeks for natural blackjack (standard timing for late surrender).
        // Player blackjack was handled above, so any dealer blackjack here is a loss.
        if (bj.checkHand(dealerCards) === 'blackjack') {
            await db.add(`${stats}.losses`, 1);
            await db.add(`${stats}.profit`, -originalBet);
            const biggestLoss = await db.get(`${stats}.biggestLoss`) || 0;
            if (originalBet > biggestLoss) await db.set(`${stats}.biggestLoss`, originalBet);
            const dealerTotal = bj.getHandValue(dealerCards);
            const embed = new EmbedBuilder()
                .setAuthor({ name: `${user.displayName}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                .setTitle(`Dealer Blackjack!`)
                .setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')} (${dealerTotal}) 🃏\n\n**${user.displayName}:**\n${initialCards.map(card => `\`${card.char}\``).join(' ')}\n\nDealer has blackjack! You lose **${originalBet.toLocaleString('en-US')}** ${CURRENCY_NAME}.\nYour balance is **${(await db.get(`${user.id}.balance`)).toLocaleString('en-US')}** ${CURRENCY_NAME}.`)
                .setColor(0xFF0000)
                .setFooter({ text: `Bet: ${originalBet.toLocaleString('en-US')} ${CURRENCY_NAME} | ${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();
            return await interaction.editReply({ embeds: [embed], components: [] });
        }

        // Late-surrender window (seconds) — forfeit button auto-expires after this if the player doesn't act.
        const FORFEIT_WINDOW_MS = 10000;

        const statusTag = (status) => status === 'bust' ? ' 💥' : status === 'blackjack' ? ' 🃏' : '';
        const renderCards = (cards) => cards.map(c => `\`${c.char}\``).join(' ');

        function buildDescription(activeHandIndex) {
            let desc = `**Dealer:**\n\`${dealerCards[0].char}\` \`??\`\n\n`;
            const multi = hands.length > 1;
            for (let i = 0; i < hands.length; i++) {
                const h = hands[i];
                const val = bj.getHandValue(h.cards);
                const tag = statusTag(bj.statusFromValue(val));
                const marker = h.isDoubled ? ' 💵' : '';
                const arrow = multi && i === activeHandIndex ? '▶️ ' : '';
                const label = multi ? `Hand ${i + 1}:` : `Your hand:`;
                const prefix = multi ? `${arrow} **${label}** ` : `**${label}** `;
                desc += `${prefix}${renderCards(h.cards)} (${val})${marker}${tag}` + (multi ? '\n' : '');
            }
            return desc;
        }

        // Main game loop - play through each hand
        async function playHands() {
            while (currentHandIndex < hands.length) {
                const currentHand = hands[currentHandIndex];
                const balance = await db.get(`${user.id}.balance`);
                const hasTwo = currentHand.cards.length === 2;
                const canAffordBet = balance >= currentHand.bet;

                const canSplitThisHand = hasTwo &&
                    bj.canSplit(currentHand.cards) &&
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

        async function playHand(hand, handIndex, canSplit, canDouble, canForfeit = false) {
            return new Promise(async (resolve) => {
                const embed = new EmbedBuilder()
                    .setAuthor({ name: `${user.displayName}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                    .setTitle(hands.length > 1 ? `Hand ${handIndex + 1} of ${hands.length}` : `Good luck!`)
                    .setColor(randomHexColor())
                    .setFooter({ text: `Bet: ${hand.bet.toLocaleString('en-US')} ${CURRENCY_NAME} | ${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                    .setTimestamp();

                embed.setDescription(buildDescription(handIndex));

                // Split aces: one card only, auto-stand
                if (hand.isSplitAces) {
                    await interaction.editReply({ embeds: [embed], components: [] });
                    await wait(1000);
                    resolve(bj.statusFromValue(bj.getHandValue(hand.cards)) === 'bust' ? 'bust' : 'stand');
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

                let msg = await interaction.editReply({ embeds: [embed], components: [buttonRow] });

                // Disables every action button except hit/stand — used when the hand is no longer eligible
                // to double/split/surrender (after the first hit or after the late-surrender window closes).
                const disableAdvancedActions = () => {
                    for (const btn of buttonRow.components) {
                        const id = btn.data?.custom_id;
                        if (id !== 'hit' && id !== 'stand') {
                            btn.setDisabled(true);
                        }
                    }
                };

                // Forfeit inactivity timer — disable the button after the window elapses if unused.
                let forfeitTimer = null;
                if (canForfeit) {
                    forfeitTimer = setTimeout(async () => {
                        const forfeitBtn = buttonRow.components.find(b => b.data?.custom_id === 'forfeit');
                        if (forfeitBtn && !forfeitBtn.data.disabled) {
                            forfeitBtn.setDisabled(true);
                            try { await msg.edit({ embeds: [embed], components: [buttonRow] }); } catch (_) {}
                        }
                    }, FORFEIT_WINDOW_MS);
                }

                const filter = i => i.user.id === user.id;
                const collector = msg.createMessageComponentCollector({ filter, time: 60000 });

                collector.on('collect', async i => {
                    // Any user action cancels the forfeit inactivity timer.
                    if (forfeitTimer) { clearTimeout(forfeitTimer); forfeitTimer = null; }

                    if (i.customId === 'hit') {
                        hand.cards.push(bj.dealCards());
                        const newVal = bj.getHandValue(hand.cards);
                        const handStatus = bj.statusFromValue(newVal);
                        logger.debug(`${user.username} Hand ${handIndex + 1}: ${hand.cards.map(c => c.name).join(' ')} = ${newVal}`);

                        embed.setDescription(buildDescription(handIndex));

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
                            // Disable double/split/forfeit after hitting
                            disableAdvancedActions();
                            await i.update({ embeds: [embed], components: [buttonRow] });
                        }
                    } else if (i.customId === 'stand') {
                        const standVal = bj.getHandValue(hand.cards);
                        embed.setDescription(buildDescription(handIndex));
                        embed.setTitle(hands.length > 1 ? `Hand ${handIndex + 1} — Stand (${standVal})` : `Stand (${standVal})`);
                        await i.update({ embeds: [embed], components: [] });
                        collector.stop('stand');
                    } else if (i.customId === 'double') {
                        await db.sub(`${user.id}.balance`, hand.bet);
                        totalBets += hand.bet;
                        hand.bet *= 2;
                        hand.isDoubled = true;

                        hand.cards.push(bj.dealCards());
                        const newVal = bj.getHandValue(hand.cards);
                        const doubleStatus = bj.statusFromValue(newVal);
                        logger.debug(`${user.username} Hand ${handIndex + 1} doubled: ${hand.cards.map(c => c.name).join(' ')} = ${newVal}`);

                        embed.setDescription(buildDescription(handIndex));
                        if (doubleStatus === 'bust') {
                            embed.setTitle(hands.length > 1 ? `Hand ${handIndex + 1} — Double Down — Bust! (${newVal})` : `Double Down — Bust! (${newVal})`);
                            embed.setColor(0xFF0000);
                        } else {
                            embed.setTitle(hands.length > 1 ? `Hand ${handIndex + 1} — Double Down (${newVal})` : `Double Down (${newVal})`);
                        }
                        embed.setFooter({ text: `Bet: ${hand.bet.toLocaleString('en-US')} ${CURRENCY_NAME} | ${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) });
                        await i.update({ embeds: [embed], components: [] });
                        collector.stop(doubleStatus === 'bust' ? 'bust' : doubleStatus === 'blackjack' ? 'blackjack' : 'stand');
                    } else if (i.customId === 'split') {
                        // Split this hand
                        await db.sub(`${user.id}.balance`, hand.bet);
                        totalBets += hand.bet;

                        const wasAcePair = bj.isAcePair(hand.cards);
                        const splitCard = hand.cards[1];
                        hand.cards = [hand.cards[0], bj.dealCards()];
                        const newHand = {
                            cards: [splitCard, bj.dealCards()],
                            bet: hand.bet,
                            isSplitAces: wasAcePair,
                            isDoubled: false
                        };
                        hand.isSplitAces = wasAcePair;

                        hands.splice(handIndex + 1, 0, newHand);
                        logger.debug(`${user.username} split hand ${handIndex + 1}. Now ${hands.length} hands.`);

                        embed.setTitle(`Split! (${hands.length} hands)`);
                        embed.setDescription(buildDescription(handIndex));
                        await i.update({ embeds: [embed], components: [] });
                        collector.stop('split');
                    } else if (i.customId === 'forfeit') {
                        // Late surrender — refund half the bet, reveal dealer hand, end the game.
                        const refund = Math.floor(hand.bet / 2);
                        const netLoss = hand.bet - refund;
                        await db.add(`${user.id}.balance`, refund);
                        await db.add(`${stats}.losses`, 1);
                        await db.add(`${stats}.surrenders`, 1);
                        await db.add(`${stats}.profit`, -netLoss);
                        const biggestLoss = await db.get(`${stats}.biggestLoss`) || 0;
                        if (netLoss > biggestLoss) await db.set(`${stats}.biggestLoss`, netLoss);

                        const dealerVal = bj.getHandValue(dealerCards);
                        const handVal = bj.getHandValue(hand.cards);
                        embed.setTitle(`Forfeit`);
                        embed.setDescription(`**Dealer:**\n${renderCards(dealerCards)} (${dealerVal})\n\n**Your hand:** ${renderCards(hand.cards)} (${handVal})\n\nYou forfeited your hand and recovered **${refund.toLocaleString('en-US')}** ${CURRENCY_NAME}.\nYour balance is **${(await db.get(`${user.id}.balance`)).toLocaleString('en-US')}** ${CURRENCY_NAME}.`);
                        embed.setColor(0xAAAAAA);
                        embed.setFooter({ text: `Bet: ${hand.bet.toLocaleString('en-US')} ${CURRENCY_NAME} (forfeited) | ${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) });
                        await i.update({ embeds: [embed], components: [] });
                        logger.info(`${user.username}(${user.id}) forfeited their hand, recovering ${refund} ${CURRENCY_NAME}.`);
                        collector.stop('forfeit');
                    }
                });

                collector.on('end', async (collected, reason) => {
                    if (forfeitTimer) { clearTimeout(forfeitTimer); forfeitTimer = null; }
                    logger.debug(`Hand ${handIndex + 1} collector ended. Reason: ${reason}`);

                    // Brief pause so the user can see the result before the next hand
                    if (hands.length > 1 && ['bust', 'blackjack', 'stand', 'double'].includes(reason)) {
                        await wait(1500);
                    }

                    if (reason === 'bust' || reason === 'blackjack' || reason === 'stand' || reason === 'forfeit') {
                        resolve(reason);
                    } else if (reason === 'split') {
                        const balance = await db.get(`${user.id}.balance`);
                        const hasTwo = hand.cards.length === 2;
                        const canAffordBet = balance >= hand.bet;
                        const canSplitThisHand = hasTwo && bj.canSplit(hand.cards) &&
                            hands.length < MAX_HANDS && !hand.isSplitAces && canAffordBet;
                        const canDoubleHand = hasTwo && !hand.isDoubled && canAffordBet;
                        resolve(await playHand(hand, handIndex, canSplitThisHand, canDoubleHand));
                    } else {
                        // timeout or unexpected reason — auto-stand
                        resolve('stand');
                    }
                });
            });
        }

        async function playDealer() {
            function buildDealerDescription() {
                const dealerVal = bj.getHandValue(dealerCards);
                let desc = `**Dealer:**\n${renderCards(dealerCards)} (${dealerVal})\n\n`;
                const multi = hands.length > 1;
                for (let i = 0; i < hands.length; i++) {
                    const h = hands[i];
                    const val = bj.getHandValue(h.cards);
                    const tag = statusTag(bj.statusFromValue(val));
                    const marker = h.isDoubled ? ' 💵' : '';
                    const label = multi ? `Hand ${i + 1}:` : `Your hand:`;
                    desc += `**${label}** ${renderCards(h.cards)} (${val})${marker}${tag}\n`;
                }
                return desc;
            }

            const dealerEmbed = new EmbedBuilder()
                .setAuthor({ name: `${user.displayName}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                .setTitle(`Dealer's turn`)
                .setColor(randomHexColor())
                .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();

            dealerEmbed.setDescription(buildDealerDescription());
            await interaction.editReply({ embeds: [dealerEmbed], components: [] });
            await wait(1000);

            // Dealer draws until hard 17+ (one value check per iteration)
            let dealerTotal = bj.getHandValue(dealerCards);
            while (dealerTotal < 17) {
                dealerCards.push(bj.dealCards());
                dealerTotal = bj.getHandValue(dealerCards);
                dealerEmbed.setDescription(buildDealerDescription());
                await interaction.editReply({ embeds: [dealerEmbed], components: [] });
                await wait(1000);
            }

            const dealerStatus = bj.statusFromValue(dealerTotal);
            let finalDescription = `**Dealer:**\n${renderCards(dealerCards)} (${dealerTotal})\n\n`;
            logger.debug(`Dealer: ${dealerCards.map(c => c.name).join(' ')} = ${dealerTotal}`);

            let totalWinnings = 0;
            let biggestHandLoss = 0;
            let resultLines = [];

            for (let i = 0; i < hands.length; i++) {
                const hand = hands[i];
                const handTotal = bj.getHandValue(hand.cards);
                const handStatus = bj.statusFromValue(handTotal);

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
                const tag = statusTag(handStatus);
                const label = hands.length > 1 ? `Hand ${i + 1}:` : `Your hand:`;
                resultLines.push(`**${label}** ${renderCards(hand.cards)} (${handTotal})${marker}${tag} → ${handResult}${winnings > 0 ? ` (+${winnings.toLocaleString('en-US')})` : ''}`);
            }

            // Add winnings
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

            // Update stats for biggest loss (only actual losses)
            if (biggestHandLoss > 0) {
                const biggestLoss = await db.get(`${stats}.biggestLoss`) || 0;
                if (biggestHandLoss > biggestLoss) {
                    await db.set(`${stats}.biggestLoss`, biggestHandLoss);
                }
            }

            // Track net profit/loss for this game
            const netProfit = totalWinnings - totalBets;
            await db.add(`${stats}.profit`, netProfit);

            const finalEmbed = new EmbedBuilder()
                .setAuthor({ name: `${user.displayName}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                .setTitle(dealerStatus === 'bust' ? 'Dealer busts!' : `Dealer: ${dealerTotal}`)
                .setDescription(`${finalDescription}${resultLines.join('\n')}\n\n${totalWinnings > totalBets ? `You won **${(totalWinnings - totalBets).toLocaleString('en-US')}** ${CURRENCY_NAME}!` : totalWinnings === totalBets ? `You broke even.` : `You lost **${(totalBets - totalWinnings).toLocaleString('en-US')}** ${CURRENCY_NAME}.`}\nYour balance is **${(await db.get(`${user.id}.balance`)).toLocaleString('en-US')}** ${CURRENCY_NAME}.`)
                .setColor(totalWinnings > totalBets ? 0x00AE86 : (totalWinnings > 0 ? 0xFFFF00 : 0xFF0000))
                .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();

            await interaction.editReply({ embeds: [finalEmbed], components: [] });
        }

        // Start the game
        await playHands();
    }
}