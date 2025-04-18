const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const { addNewDBUser, setDBValue } = require("../../database");
const { CURRENCY_NAME } = require("../../config.json");
const { parseBet } = require('../../utils/betparse');
const wait = require('node:timers/promises').setTimeout;
const bj = require('../../utils/blackjack');
const logger = require("../../utils/logger");
const { randomHexColor } = require('../../utils/randomcolor');

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

        let bet = Number(await parseBet(option, user.id));
        const dbUser = await db.get(user.id);

        logger.info(`${user.username}(${user.id}) initialized a game of blackjack with a bet of ${bet} ${CURRENCY_NAME}.`)

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
            );

        if (dbUser.balance < bet * 2) {
            buttonRow.components[2].setDisabled(true);
        }

        await interaction.deferReply();

        let dealerCards = [];
        let playerCards = [];
        let playerTotal = 0;
        let dealerTotal = 0;

        for (let i = 0; i < 2; i++) {
            dealerCards.push(await bj.dealCards());
            playerCards.push(await bj.dealCards());
        }
        dealerTotal = await bj.getHandValue(dealerCards);
        playerTotal = await bj.getHandValue(playerCards);
        logger.debug(`Dealer: ${dealerCards[0].name} ${dealerCards[1].name} = ${dealerCards[0].value + dealerCards[1].value}`);
        logger.debug(`${user.username}: ${playerCards[0].name} ${playerCards[1].name} = ${playerCards[0].value + playerCards[1].value}`);

        const embed = new EmbedBuilder()
            .setAuthor({ name: `${user.displayName }`, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setTitle(`Good luck!`)
            .setColor(randomHexColor())
            .setFooter({ text: `Bet: ${bet} ${CURRENCY_NAME} | ${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        let winnings = Number(bet);
        if (await bj.checkHand(playerCards) === 'safe') {
            await db.sub(`${user.id}.balance`, bet);
            embed.setDescription(`**Dealer:**\n\`${dealerCards[0].char}\` \`??\`\n\n**${user.displayName }:**\n\`${playerCards[0].char}\` \`${playerCards[1].char}\``)
            let msg = await interaction.editReply({ embeds: [embed], components: [buttonRow] });

            const filter = i => i.user.id === user.id;
            const collector = msg.createMessageComponentCollector({ filter, time: 60000 });
    
            collector.on('collect', async i => {
                if (i.customId !== 'double') {
                    buttonRow.components[2].setDisabled(true);
                }
                if (i.customId === 'hit') {
                    playerCards = await bj.hit(playerCards);
                    playerTotal = await bj.getHandValue(playerCards);
                    logger.debug(`${user.username}: ${playerCards.map(card => card.name).join(' ')} = ${playerTotal}`);
                    logger.debug(`status: ${await bj.checkHand(playerCards)}`);
                    if (await bj.checkHand(playerCards) !== 'safe') {
                        let reason = await bj.checkHand(playerCards);
                        collector.stop(reason);
                    } else {
                        embed.setDescription(`**Dealer:**\n\`${dealerCards[0].char}\` \`??\`\n\n**${user.displayName }:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}`);
                        await i.update({ embeds: [embed] });
                    }
                } else if (i.customId === 'stand' || i.customId === 'double') {
                    if (i.customId === 'double') {
                        bet = (bet * 2);
                        await db.sub(`${user.id}.balance`, bet / 2);
                        
                        playerCards = await bj.hit(playerCards);
                        playerTotal = await bj.getHandValue(playerCards);
                        logger.debug(`${user.username}: ${playerCards.map(card => card.name).join(' ')} = ${playerTotal}`);
                        logger.debug(`status: ${await bj.checkHand(playerCards)}`);
                        if (await bj.checkHand(playerCards) !== 'safe') {
                            let reason = await bj.checkHand(playerCards);
                            return collector.stop(reason);
                        } else {
                            embed.setDescription(`**Dealer:**\n\`${dealerCards[0].char}\` \`??\`\n\n**${user.displayName }:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}`);
                            await interaction.editReply({ embeds: [embed] });
                            await wait(1000);
                        }
                    }
                    embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.displayName }:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}`);
                    await interaction.editReply({ embeds: [embed], components: [] });
                    await wait(1000);
                    if ((dealerTotal > playerTotal) || (dealerTotal == 21)) {
                        logger.debug(`Dealer wins!`);
                        embed.setTitle(`Dealer wins!`);
                        return collector.stop('lose');
                    } 
                    while (await bj.dealerChoice(dealerCards, playerCards) === 'hit' && (await bj.checkHand(dealerCards) === 'safe')) {
                        logger.debug(`Dealer choice is hit.`);
                        embed.setTitle(`I'm going to hit.`);
                        dealerCards = await bj.hit(dealerCards);
                        dealerTotal = await bj.getHandValue(dealerCards);
                        logger.debug(`Dealer: ${dealerCards.map(card => card.name).join(' ')} = ${dealerTotal}`);
                        logger.debug(`status: ${await bj.checkHand(dealerCards)}`);
                        embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.displayName }:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}`);
                        await interaction.editReply({ embeds: [embed] });
                        await wait(1000);
                    }
                    if (await bj.checkHand(dealerCards) !== 'safe') {
                        let reason = await bj.checkHand(dealerCards);
                        if (reason === 'bust') {
                            logger.debug(`Dealer busts!`);
                            embed.setTitle(`Dealer busts!`);
                            return collector.stop('win');
                        } else if (reason === 'blackjack') {
                            logger.debug(`Dealer has blackjack!`);
                            embed.setTitle(`Dealer has blackjack!`);
                            return collector.stop('lose');
                        }
                    }
                    if (await bj.dealerChoice(dealerCards, playerCards) === 'stand') {
                        logger.debug(`Dealer choice is stand.`);
                        embed.setTitle(`I'm going to stand.`);
                        await interaction.editReply({ embeds: [embed] });
                        await wait(1000);
                        if (dealerTotal > playerTotal) {
                            logger.debug(`Dealer wins!`);
                            embed.setTitle(`Dealer wins!`);
                            return collector.stop('lose');
                        } else if (dealerTotal < playerTotal) {
                            logger.debug(`${user.username} wins!`);
                            embed.setTitle(`${user.displayName } wins!`);
                            return collector.stop('win');
                        } else if (dealerTotal === playerTotal) {
                            logger.debug(`It's a tie!`);
                            embed.setTitle(`It's a tie!`);
                            return collector.stop('tie');
                        }
                    }
                } 
            });
            collector.on('end', async (collected, reason) => {
                logger.debug(`Blackjack collector ended. Collected ${collected.size} interactions. Reason: ${reason}`);
                if (reason === 'blackjack') {
                    winnings += Math.ceil(bet * 1.5);
                    await db.add(`${user.id}.balance`, winnings);
                    await db.add(`${stats}.wins`, 1);
                    await db.add(`${stats}.blackjacks`, 1);
                    if (winnings > await db.get(`${stats}.blackjack.biggestWin`)) await db.set(`${stats}.blackjack.biggestWin`, winnings);
                    embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.displayName }:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou got blackjack! You win **${winnings}** ${CURRENCY_NAME}!\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                    embed.setTitle(`Blackjack!`);
                    embed.setColor(0x00AE86);
                    await interaction.editReply({ embeds: [embed], components: [] });
                }
                else if (reason === 'win') {
                    winnings += bet;
                    await db.add(`${user.id}.balance`, winnings);
                    await db.add(`${stats}.wins`, 1);
                    if (winnings > await db.get(`${stats}.blackjack.biggestWin`)) await db.set(`${stats}.blackjack.biggestWin`, winnings);
                    embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.displayName }:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou win **${winnings}** ${CURRENCY_NAME}!\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                    embed.setColor(0x00AE86);
                    await interaction.editReply({ embeds: [embed], components: [] });
                }
                else if (reason == 'tie') {
                    await db.add(`${user.id}.balance`, bet);
                    await db.add(`${stats}.ties`, 1);
                    embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.displayName }:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nIt's a tie! You get your bet back.\nYour balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                    embed.setColor(0xFFFF00);
                    await interaction.editReply({ embeds: [embed], components: [] });
                }
                else if (reason === 'bust') {
                    await db.add(`${stats}.losses`, 1);
                    if (bet > await db.get(`${stats}.blackjack.biggestLoss`)) await db.set(`${stats}.blackjack.biggestLoss`, bet);
                    embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.displayName }:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou busted! You lose your bet of **${bet}** ${CURRENCY_NAME}.\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                    embed.setTitle(`You busted!`);
                    embed.setColor(0xFF0000);
                    await interaction.editReply({ embeds: [embed], components: [] });
                }
                else if (reason === 'lose') {
                    await db.add(`${stats}.losses`, 1);
                    if (bet > await db.get(`${stats}.blackjack.biggestLoss`)) await db.set(`${stats}.blackjack.biggestLoss`, bet);
                    embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.displayName }:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou lose **${bet}** ${CURRENCY_NAME}.\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                    embed.setColor(0xFF0000);
                    await interaction.editReply({ embeds: [embed], components: [] });
                }
                else if (reason === 'time') {
                    await db.add(`${stats}.losses`, 1);
                    if (bet > await db.get(`${stats}.blackjack.biggestLoss`)) await db.set(`${stats}.blackjack.biggestLoss`, bet);
                    embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.displayName }:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou didn't respond in time, so you forfeit your bet of **${bet}** ${CURRENCY_NAME}.\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                    embed.setTitle(`Time's up! You forfeit.`);
                    embed.setColor(0xFF0000);
                    await interaction.editReply({ embeds: [embed], components: [] });
                }
            });
        } else if (await bj.checkHand(playerCards) === 'blackjack') {
            winnings = Math.ceil(bet * 1.5);
            await db.add(`${user.id}.balance`, winnings);
            await db.add(`${stats}.wins`, 1);
            await db.add(`${stats}.blackjacks`, 1);
            if (winnings > await db.get(`${stats}.blackjack.biggestWin`)) await db.set(`${stats}.blackjack.biggestWin`, winnings);
            embed.setDescription(`**Dealer:**\n\`${dealerCards[0].char}\` \`??\`\n\n**${user.displayName }:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou got blackjack! You win **${bet * 1.5}** ${CURRENCY_NAME}!\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
            embed.setTitle(`Blackjack!`);
            embed.setColor(0x00AE86);
            return await interaction.reply({ embeds: [embed], components: [] });
        } else if (await bj.checkHand(playerCards) === 'bust') {
            await db.add(`${stats}.losses`, 1);
            if (bet > await db.get(`${stats}.blackjack.biggestLoss`)) await db.set(`${stats}.blackjack.biggestLoss`, bet);
            embed.setDescription(`**Dealer:**\n\`${dealerCards[0].char}\` \`??\`\n\n**${user.displayName }:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou busted! You lose your bet of **${bet}** ${CURRENCY_NAME}.\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
            embed.setTitle(`You busted!`);
            embed.setColor(0xFF0000);
            return await interaction.reply({ embeds: [embed], components: [] });
        }
    }
}