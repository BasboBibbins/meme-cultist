const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: "./db/users.sqlite" });

const { addNewDBUser, setDBValue } = require("../../database");

const { CURRENCY_NAME } = require("../../config.json");
const { parseBet } = require('../../utils/betparse');

const wait = require('node:timers/promises').setTimeout;

const bj = require('../../utils/blackjack');
const { dealerChoice } = require('../../utils/blackjack');

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

        let bet = await parseBet(option, user.id);
        const dbUser = await db.get(user.id);

        console.log(`\x1b[34m[INFO]\x1b[0m ${user.username}#${user.discriminator} (${user.id}) initialized a game of blackjack with a bet of ${bet} ${CURRENCY_NAME}.`)

        if (!dbUser) {
            await addNewDBUser(user.id);
            return interaction.reply({ content: `You don't have an account! Please use \`/daily\` to create one.`, ephemeral: true });
        }
        if (bet > dbUser.balance) {
            return interaction.reply({ content: `You don't have enough ${CURRENCY_NAME}!`, ephemeral: true });
        }
        if (bet < 1) {
            return interaction.reply({ content: `You can't bet less than 1 ${CURRENCY_NAME}!`, ephemeral: true });
        }
        if (bet % 1 !== 0) {
            return interaction.reply({ content: `You must bet a whole number of ${CURRENCY_NAME}!`, ephemeral: true });
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
        console.log(`Dealer: ${dealerCards[0].name} ${dealerCards[1].name} = ${dealerCards[0].value + dealerCards[1].value}\n${user.username}: ${playerCards[0].name} ${playerCards[1].name} = ${playerCards[0].value + playerCards[1].value}`);

        const embed = new EmbedBuilder()
            .setAuthor({ name: `${user.username}#${user.discriminator}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setTitle(`Good luck!`)
            .setColor(0x00AE86)
            .setDescription(`**Dealer:**\n\`??\` \`??\`\n\n**${user.username}:**\n\`${playerCards[0].char}\` \`${playerCards[1].char}\``)
            .setFooter({ text: `Bet: ${bet} ${CURRENCY_NAME}` })
            .setTimestamp();

        let winnings = 0;
        if (await bj.checkHand(playerCards) === 'safe') {
            await db.sub(`${user.id}.balance`, bet);
            await interaction.reply({ embeds: [embed], components: [buttonRow] });

            const filter = i => i.user.id === user.id;
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });
    
            collector.on('collect', async i => {
                if (i.customId !== 'double') {
                    buttonRow.components[2].setDisabled(true);
                }
                if (i.customId === 'hit') {
                    playerCards = await bj.hit(playerCards);
                    playerTotal = await bj.getHandValue(playerCards);
                    console.log(`${user.username}: ${playerCards.map(card => card.name).join(' ')} = ${playerTotal}`);
                    console.log(`status: ${await bj.checkHand(playerCards)}`);
                    if (await bj.checkHand(playerCards) !== 'safe') {
                        let reason = await bj.checkHand(playerCards);
                        collector.stop(reason);
                    } else {
                        embed.setDescription(`**Dealer:**\n\`??\` \`??\`\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}`);
                        await i.update({ embeds: [embed] });
                    }
                } else if (i.customId === 'stand' || i.customId === 'double') {
                    if (i.customId === 'double') {
                        bet = bet * 2;
                        await db.sub(`${user.id}.balance`, bet / 2);
                        
                        playerCards = await bj.hit(playerCards);
                        playerTotal = await bj.getHandValue(playerCards);
                        console.log(`${user.username}: ${playerCards.map(card => card.name).join(' ')} = ${playerTotal}`);
                        console.log(`status: ${await bj.checkHand(playerCards)}`);
                        if (await bj.checkHand(playerCards) !== 'safe') {
                            let reason = await bj.checkHand(playerCards);
                            return collector.stop(reason);
                        } else {
                            embed.setDescription(`**Dealer:**\n\`??\` \`??\`\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}`);
                            await interaction.editReply({ embeds: [embed] });
                            await wait(1000);
                        }
                    }
                    embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}`);
                    await interaction.editReply({ embeds: [embed], components: [] });
                    await wait(1000);
                    if ((dealerTotal > playerTotal) || (dealerTotal == 21)) {
                        console.log(`Dealer wins!`);
                        return collector.stop('lose');
                    } 
                    while (await dealerChoice(dealerCards) === 'hit' && (await bj.checkHand(dealerCards) === 'safe')) {
                        console.log(`Dealer choice is hit.`);
                        dealerCards = await bj.hit(dealerCards);
                        dealerTotal = await bj.getHandValue(dealerCards);
                        console.log(`Dealer: ${dealerCards.map(card => card.name).join(' ')} = ${dealerTotal}`);
                        console.log(`status: ${await bj.checkHand(dealerCards)}`);
                        embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}`);
                        await interaction.editReply({ embeds: [embed] });
                        await wait(1000);
                    }
                    if (await bj.checkHand(dealerCards) !== 'safe') {
                        let reason = await bj.checkHand(dealerCards);
                        if (reason === 'bust') {
                            console.log(`Dealer busts!`);
                            return collector.stop('win');
                        } else if (reason === 'blackjack') {
                            console.log(`Dealer has blackjack!`);
                            return collector.stop('lose');
                        }
                    }
                    if (await dealerChoice(dealerCards) === 'stand') {
                        console.log(`Dealer choice is stand.`);
                        console.log(`Dealer: ${dealerCards.map(card => card.name).join(' | ')} = ${dealerTotal}\n${user.username}: ${playerCards.map(card => card.name).join(' | ')} = ${playerTotal}`);
                        if (dealerTotal > playerTotal) {
                            console.log(`Dealer wins!`);
                            return collector.stop('lose');
                        } else if (dealerTotal < playerTotal) {
                            console.log(`${user.username} wins!`);
                            return collector.stop('win');
                        } else if (dealerTotal === playerTotal) {
                            console.log(`It's a tie!`);
                            return collector.stop('tie');
                        }
                    }
                } 
            });
            collector.on('end', async (collected, reason) => {
                if (reason === 'blackjack') {
                    winnings = bet * 1.5;
                    await db.add(`${user.id}.balance`, winnings);
                    await db.add(`${stats}.wins`, 1);
                    await db.add(`${stats}.blackjacks`, 1);
                    embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou got blackjack! You win **${winnings}** ${CURRENCY_NAME}!\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                    embed.setTitle(`Blackjack!`);
                    embed.setColor(0x00AE86);
                    await interaction.editReply({ embeds: [embed], components: [] });
                }
                else if (reason === 'win') {
                    winnings = bet;
                    await db.add(`${user.id}.balance`, winnings);
                    await db.add(`${stats}.wins`, 1);
                    embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou win! You win **${winnings}** ${CURRENCY_NAME}!\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                    embed.setTitle(`You win!`);
                    embed.setColor(0x00AE86);
                    await interaction.editReply({ embeds: [embed], components: [] });
                }
                else if (reason == 'tie') {
                    await db.add(`${user.id}.balance`, bet);
                    await db.add(`${stats}.ties`, 1);
                    embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nIt's a tie! You get your bet back.`);
                    embed.setTitle(`It's a tie!`);
                    embed.setColor(0xFF0000);
                    await interaction.editReply({ embeds: [embed], components: [] });
                }
                else if (reason === 'bust') {
                    await db.add(`${stats}.losses`, 1);
                    embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou busted! You lose your bet of **${bet}** ${CURRENCY_NAME}.\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                    embed.setTitle(`You busted!`);
                    embed.setColor(0xFF0000);
                    await interaction.editReply({ embeds: [embed], components: [] });
                }
                else if (reason === 'lose') {
                    await db.add(`${stats}.losses`, 1);
                    embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou lose! You lose **${bet}** ${CURRENCY_NAME}.\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                    embed.setTitle(`You lose!`);
                    embed.setColor(0xFF0000);
                    await interaction.editReply({ embeds: [embed], components: [] });
                }
                else if (reason === 'time') {
                    await db.add(`${stats}.losses`, 1);
                    embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou didn't respond in time, so you forfeit your bet of **${bet}** ${CURRENCY_NAME}.\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                    embed.setTitle(`Time's up! You forfeit.`);
                    embed.setColor(0xFF0000);
                    await interaction.editReply({ embeds: [embed], components: [] });
                }
            });
        } else if (await bj.checkHand(playerCards) === 'blackjack') {
            winnings = bet * 1.5;
            await db.add(`${user.id}.balance`, winnings);
            await db.add(`${stats}.wins`, 1);
            await db.add(`${stats}.blackjacks`, 1);
            embed.setDescription(`**Dealer:**\n\`??\` \`??\`\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou got blackjack! You win **${bet * 1.5}** ${CURRENCY_NAME}!\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
            embed.setTitle(`Blackjack!`);
            embed.setColor(0x00AE86);
            return await interaction.reply({ embeds: [embed], components: [] });
        } else if (await bj.checkHand(playerCards) === 'bust') {
            await db.add(`${stats}.losses`, 1);
            embed.setDescription(`**Dealer:**\n\`??\` \`??\`\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou busted! You lose your bet of **${bet}** ${CURRENCY_NAME}.\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
            embed.setTitle(`You busted!`);
            embed.setColor(0xFF0000);
            return await interaction.reply({ embeds: [embed], components: [] });
        }
    }
}