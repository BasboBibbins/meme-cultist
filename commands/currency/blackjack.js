const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: "./db/users.sqlite" });

const { addNewDBUser, setDBValue } = require("../../database");

const { CURRENCY_NAME } = require("../../config.json");
const { parseBet } = require('../../utils/betparse');

const wait = require('node:timers/promises').setTimeout;

async function dealCards() {
    const cards = [
        { name: 'Ace', char: 'A', value: 11 },
        { name: 'Two', char: '2', value: 2 },
        { name: 'Three', char: '3', value: 3 },
        { name: 'Four', char: '4', value: 4 },
        { name: 'Five', char: '5', value: 5 },
        { name: 'Six', char: '6', value: 6 },
        { name: 'Seven', char: '7', value: 7 },
        { name: 'Eight', char: '8', value: 8 },
        { name: 'Nine', char: '9', value: 9 },
        { name: 'Ten', char: '10', value: 10 },
        { name: 'Jack', char: 'J', value: 10 },
        { name: 'Queen', char: 'Q', value: 10 },
        { name: 'King', char: 'K', value: 10 },
    ];
    const card = cards[Math.floor(Math.random() * cards.length)];
    return card;
}

async function aceCheck(hand) {
    let total = 0;
    let aces = 0;
    for (let i = 0; i < hand.length; i++) {
        if (hand[i].name == 'Ace') {
            aces++;
        }
        total += hand[i].value;
    }
    if (aces > 0) {
        for (let i = 0; i < aces; i++) {
            if (total > 21) {
                total -= 10;
            }
        }
    }
    return total;
}

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

        const bet = await parseBet(option, user.id);
        const dbUser = await db.get(user.id);
        /*
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
        */
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

        if (await db.get(`${user.id}.balance`) < bet * 2) {
            buttonRow.components[2].setDisabled(true);
        }

        let dealerCards = [];
        let playerCards = [];
        let playerTotal = 0;
        let dealerTotal = 0;

        for (let i = 0; i < 2; i++) {
            dealerCards.push(await dealCards());
            playerCards.push(await dealCards());
        }

        for (let i = 0; i < dealerCards.length; i++) {
            dealerTotal += dealerCards[i].value;
        }

        for (let i = 0; i < playerCards.length; i++) {
            playerTotal += playerCards[i].value;
        }

        console.log(`Dealer: ${dealerCards[0].name} ${dealerCards[1].name} = ${dealerCards[0].value + dealerCards[1].value}\n${user.username}: ${playerCards[0].name} ${playerCards[1].name} = ${playerCards[0].value + playerCards[1].value}`);

        const embed = new EmbedBuilder()
            .setAuthor({ name: `${user.username}#${user.discriminator}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setTitle(`Good luck!`)
            .setColor(0x00AE86)
            .setDescription(`**Dealer:**\n\`??\` \`??\`\n\n**${user.username}:**\n\`${playerCards[0].char}\` \`${playerCards[1].char}\``)
            .setFooter({ text: `Bet: ${bet} ${CURRENCY_NAME}` })
            .setTimestamp();
        await interaction.reply({ embeds: [embed], components: [buttonRow] });

        const filter = i => i.user.id === user.id;
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

        collector.on('collect', async i => {
            if (i.customId !== 'double') {
                buttonRow.components[2].setDisabled(true);
            }
            if (i.customId === 'hit') {
                playerCards.push(await dealCards());
                playerTotal = 0;
                for (let i = 0; i < playerCards.length; i++) {
                    playerTotal += playerCards[i].value;
                }
                console.log(`${user.username}: ${playerTotal}`);
                if (playerTotal > 21) {
                    // if over 21, check for aces. if there are aces, change their value to 1 and recalculate total
                    if (playerCards.some(card => card.name === 'Ace')) {
                        for (let i = 0; i < playerCards.length; i++) {
                            if (playerCards[i].name === 'Ace') {
                                playerCards[i].value = 1;
                                playerTotal = 0;
                                for (let i = 0; i < playerCards.length; i++) {
                                    playerTotal += playerCards[i].value;
                                }
                                break;
                            }
                        }
                    } else {
                        embed.setDescription(`**Dealer:**\n\`${dealerCards[0].char}\` \`${dealerCards[1].char}\`\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou lost **${bet}** ${CURRENCY_NAME}.\nYour new balance is **${dbUser.balance - bet}** ${CURRENCY_NAME}.`);
                        embed.setTitle(`Bust! You lost!`);
                        embed.setColor(0xFF0000);
                        await i.update({ embeds: [embed], components: [] });
                        return collector.stop();
                    }
                }
                embed.setDescription(`**Dealer:**\n\`??\` \`??\`\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}`);
                await i.update({ embeds: [embed] });
            } else if (i.customId === 'stand') {
                while (dealerTotal < 17) {
                    i.deferUpdate();
                    dealerCards.push(await dealCards());
                    dealerTotal = 0;
                    for (let i = 0; i < dealerCards.length; i++) {
                        dealerTotal += dealerCards[i].value;
                    }
                    console.log(`Dealer: ${dealerTotal}`);
                    if (dealerTotal > 21) {
                        // if over 21, check for aces. if there are aces, change their value to 1 and recalculate total
                        if (dealerCards.some(card => card.name === 'Ace')) {
                            for (let i = 0; i < dealerCards.length; i++) {
                                if (dealerCards[i].name === 'Ace') {
                                    dealerCards[i].value = 1;
                                    dealerTotal = 0;
                                    for (let i = 0; i < dealerCards.length; i++) {
                                        dealerTotal += dealerCards[i].value;
                                    }
                                    break;
                                }
                            }
                        } else {
                            embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou won **${bet}** ${CURRENCY_NAME}!\nYour new balance is **${dbUser.balance + bet}** ${CURRENCY_NAME}.`);
                            embed.setTitle(`Dealer bust! You win!`);
                            embed.setColor(0x00FF00);
                            await i.update({ embeds: [embed], components: [] });
                            return collector.stop();
                        }
                    }
                    await wait(1000);
                }
                if (playerTotal > dealerTotal) {
                    embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou won **${bet}** ${CURRENCY_NAME}!\nYour new balance is **${dbUser.balance + bet}** ${CURRENCY_NAME}.`);
                    embed.setTitle(`You win!`);
                    embed.setColor(0x00FF00);
                    await i.update({ embeds: [embed], components: [] });
                    return collector.stop();
                } else if (playerTotal === dealerTotal) {
                    embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou tied with the dealer!\nYour bet of **${bet}** ${CURRENCY_NAME} has been returned to you.`);
                    embed.setTitle(`It's a tie!`);
                    embed.setColor(0xFFA500);
                    await i.update({ embeds: [embed], components: [] });
                    return collector.stop();
                } else if (playerTotal < dealerTotal) {
                    embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou lost **${bet}** ${CURRENCY_NAME}.\nYour new balance is **${dbUser.balance - bet}** ${CURRENCY_NAME}.`);
                    embed.setTitle(`You lost!`);
                    embed.setColor(0xFF0000);
                    await i.update({ embeds: [embed], components: [] });
                    return collector.stop();
                }
            } else if (i.customId === 'double') {
                if (dbUser.balance < bet * 2) {
                    embed.setDescription(`You don't have enough ${CURRENCY_NAME} to double down!`);
                    embed.setTitle(`Not enough ${CURRENCY_NAME}!`);
                    embed.setColor(0xFF0000);
                    await i.update({ embeds: [embed], components: [] });
                    return collector.stop();
                }
                bet *= 2;
                playerCards.push(await dealCards());
                playerTotal = 0;
                for (let i = 0; i < playerCards.length; i++) {
                    playerTotal += playerCards[i].value;
                }
                console.log(`${user.username}: ${playerTotal}`);
                if (playerTotal > 21) {
                    // if over 21, check for aces. if there are aces, change their value to 1 and recalculate total
                    if (playerCards.some(card => card.name === 'Ace')) {
                        for (let i = 0; i < playerCards.length; i++) {
                            if (playerCards[i].name === 'Ace') {
                                playerCards[i].value = 1;
                                playerTotal = 0;
                                for (let i = 0; i < playerCards.length; i++) {
                                    playerTotal += playerCards[i].value;
                                }
                                break;
                            }
                        }
                    } else {
                        embed.setDescription(`**Dealer:**\n\`${dealerCards[0].char}\` \`${dealerCards[1].char}\`\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou lost **${bet}** ${CURRENCY_NAME}.\nYour new balance is **${dbUser.balance - bet}** ${CURRENCY_NAME}.`);
                        embed.setTitle(`Bust! You lost!`);
                        embed.setColor(0xFF0000);
                        await i.update({ embeds: [embed], components: [] });
                        return collector.stop();
                    }
                }
                while (dealerTotal < 17) {
                    i.deferUpdate();
                    dealerCards.push(await dealCards());
                    dealerTotal = 0;
                    for (let i = 0; i < dealerCards.length; i++) {
                        dealerTotal += dealerCards[i].value;
                    }
                    console.log(`Dealer: ${dealerTotal}`);
                    if (dealerTotal > 21) {
                        // if over 21, check for aces. if there are aces, change their value to 1 and recalculate total
                        if (dealerCards.some(card => card.name === 'Ace')) {
                            for (let i = 0; i < dealerCards.length; i++) {
                                if (dealerCards[i].name === 'Ace') {
                                    dealerCards[i].value = 1;
                                    dealerTotal = 0;
                                    for (let i = 0; i < dealerCards.length; i++) {
                                        dealerTotal += dealerCards[i].value;
                                    }
                                    break;
                                }
                            }
                        } else {
                            embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou won **${bet}** ${CURRENCY_NAME}!\nYour new balance is **${dbUser.balance + bet}** ${CURRENCY_NAME}.`);
                            embed.setTitle(`Dealer bust! You win!`);
                            embed.setColor(0x00FF00);
                            await i.update({ embeds: [embed], components: [] });
                            return collector.stop();
                        }
                    }
                    await wait(1000);
                }
                if (playerTotal > dealerTotal) {
                    embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou won **${bet}** ${CURRENCY_NAME}!\nYour new balance is **${dbUser.balance + bet}** ${CURRENCY_NAME}.`);
                    embed.setTitle(`You win!`);
                    embed.setColor(0x00FF00);
                    await i.update({ embeds: [embed], components: [] });
                    return collector.stop();
                } else if (playerTotal === dealerTotal) {
                    embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou tied with the dealer!\nYour bet of **${bet}** ${CURRENCY_NAME} has been returned to you.`);
                    embed.setTitle(`It's a tie!`);
                    embed.setColor(0xFFA500);
                    await i.update({ embeds: [embed], components: [] });
                    return collector.stop();
                } else if (playerTotal < dealerTotal) {
                    embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou lost **${bet}** ${CURRENCY_NAME}.\nYour new balance is **${dbUser.balance - bet}** ${CURRENCY_NAME}.`);
                    embed.setTitle(`You lost!`);
                    embed.setColor(0xFF0000);
                    await i.update({ embeds: [embed], components: [] });
                    return collector.stop();
                }
            } 
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'time') {
                embed.setDescription(`**Dealer:**\n${dealerCards.map(card => `\`${card.char}\``).join(' ')}\n\n**${user.username}:**\n${playerCards.map(card => `\`${card.char}\``).join(' ')}\n\nYou didn't respond in time, so you forfeit your bet of **${bet}** ${CURRENCY_NAME}.\nYour new balance is **${dbUser.balance}** ${CURRENCY_NAME}.`);
                embed.setTitle(`Time's up! You forfeit.`);
                embed.setColor(0xFF0000);
                await i.update({ embeds: [embed], components: [] });
            }
        });
    }
}