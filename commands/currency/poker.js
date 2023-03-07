const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Attachment, AttachmentBuilder } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const { addNewDBUser } = require("../../database");
const { CURRENCY_NAME } = require("../../config.json");
const { parseBet } = require('../../utils/betparse');
const wait = require('node:timers/promises').setTimeout;
const { shuffleDeck, newDeck, dealHand, drawCard } = require('../../utils/deckofcards');
const logger = require("../../utils/logger");
const { randomHexColor } = require('../../utils/randomcolor');
const { getCard, canvasHand, pokerScore } = require('../../utils/poker');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('poker')
        .setDescription(`Play a game of poker against the bot.`)
        .addStringOption(option => option.setName('bet').setDescription('The amount of money you want to bet.').setRequired(true)),
    async execute(interaction) {
        const user = interaction.user;
        const option = interaction.options.getString('bet');
        const stats = `${user.id}.stats.poker`;

        let bet = Number(await parseBet(option, user.id));
        const dbUser = await db.get(user.id);

        if (db.get(stats) === undefined) {
            db.set(stats, { wins: 0, losses: 0, royals: 0, biggestWin: 0, biggestLoss: 0 });
        }
        
        logger.log(`${user.username}#${user.discriminator} (${user.id}) initialized a game of poker with a bet of ${bet} ${CURRENCY_NAME}.`);
        
        const error_embed = new EmbedBuilder()
            .setAuthor({ name: user.username + "#" + user.discriminator, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setColor(0xFF0000)
            .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
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
        
        let msg = await interaction.deferReply(interaction);
        await db.sub(`${user.id}.balance`, bet);

        const embed = new EmbedBuilder()
            .setAuthor({ name: user.username, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setTitle(`Good luck!`)
            .setColor(randomHexColor())
            .setFooter({ text: `Bet: ${bet} ${CURRENCY_NAME} | Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        const deck = await newDeck();
        let heldCards = await dealHand(deck);

        logger.debug(`${heldCards[0].code} | ${heldCards[1].code} | ${heldCards[2].code} | ${heldCards[3].code} | ${heldCards[4].code}`)

        const hold_row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('card1')
                    .setLabel(`${heldCards[0].value} HOLD`)
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji(heldCards[0].emoji),
                new ButtonBuilder()
                    .setCustomId('card2')
                    .setLabel(`${heldCards[1].value} HOLD`)
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji(heldCards[1].emoji),
                new ButtonBuilder()
                    .setCustomId('card3')
                    .setLabel(`${heldCards[2].value} HOLD`)
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji(heldCards[2].emoji),
                new ButtonBuilder()
                    .setCustomId('card4')
                    .setLabel(`${heldCards[3].value} HOLD`)
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji(heldCards[3].emoji),
                new ButtonBuilder()
                    .setCustomId('card5')
                    .setLabel(`${heldCards[4].value} HOLD`)
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji(heldCards[4].emoji),
            );
        let file = await canvasHand(heldCards, heldCards.score);

        const draw_row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('draw')
                    .setLabel('Draw')
                    .setStyle(ButtonStyle.Success),
            );

        embed.setImage(`attachment://hand.png`);
        msg = await interaction.editReply({ embeds: [embed], components: [hold_row, draw_row], fetchReply: true, files: [file] });

        const filter = i => i.user.id === user.id;
        const collector = msg.createMessageComponentCollector({ filter, time: 30000 });

        collector.on('collect', async i => {
            await i.deferUpdate();
            switch (i.customId) {
                case 'card1':
                    if (heldCards[0].hold) {
                        heldCards[0].hold = false;
                        hold_row.components[0].setStyle(ButtonStyle.Primary);
                        hold_row.components[0].setLabel(`${heldCards[0].value} HOLD`)
                    } else {
                        heldCards[0].hold = true;
                        hold_row.components[0].setStyle(ButtonStyle.Secondary);
                        hold_row.components[0].setLabel(`${heldCards[0].value} HOLDING`);
                    }
                    file = await canvasHand(heldCards, heldCards.score);
                    i.editReply({ components: [hold_row, draw_row], embeds: [embed.setImage(`attachment://hand.png`)], files: [file] });
                    break;
                case 'card2':
                    if (heldCards[1].hold) {
                        heldCards[1].hold = false;
                        hold_row.components[1].setStyle(ButtonStyle.Primary);
                        hold_row.components[1].setLabel(`${heldCards[1].value} HOLD`);
                    } else {
                        heldCards[1].hold = true;
                        hold_row.components[1].setStyle(ButtonStyle.Secondary);
                        hold_row.components[1].setLabel(`${heldCards[1].value} HOLDING`);
                    }
                    file = await canvasHand(heldCards, heldCards.score);
                    i.editReply({ components: [hold_row, draw_row], embeds: [embed.setImage(`attachment://hand.png`)], files: [file] });
                    break;
                case 'card3':
                    if (heldCards[2].hold) {
                        heldCards[2].hold = false;
                        hold_row.components[2].setStyle(ButtonStyle.Primary);
                        hold_row.components[2].setLabel(`${heldCards[2].value} HOLD`);
                    } else {
                        heldCards[2].hold = true;
                        hold_row.components[2].setStyle(ButtonStyle.Secondary);
                        hold_row.components[2].setLabel(`${heldCards[2].value} HOLDING`);
                    }
                    file = await canvasHand(heldCards, heldCards.score);
                    i.editReply({ components: [hold_row, draw_row], embeds: [embed.setImage(`attachment://hand.png`)], files: [file] });
                    break;
                case 'card4':
                    if (heldCards[3].hold) {
                        heldCards[3].hold = false;
                        hold_row.components[3].setStyle(ButtonStyle.Primary);
                        hold_row.components[3].setLabel(`${heldCards[3].value} HOLD`);
                    } else {
                        heldCards[3].hold = true;
                        hold_row.components[3].setStyle(ButtonStyle.Secondary);
                        hold_row.components[3].setLabel(`${heldCards[3].value} HOLDING`);
                    }
                    file = await canvasHand(heldCards, heldCards.score);
                    i.editReply({ components: [hold_row, draw_row], embeds: [embed.setImage(`attachment://hand.png`)], files: [file] });
                    break;
                case 'card5':
                    if (heldCards[4].hold) {
                        heldCards[4].hold = false;
                        hold_row.components[4].setStyle(ButtonStyle.Primary);
                        hold_row.components[4].setLabel(`${heldCards[4].value} HOLD`);
                    } else {
                        heldCards[4].hold = true;
                        hold_row.components[4].setStyle(ButtonStyle.Secondary);
                        hold_row.components[4].setLabel(`${heldCards[4].value} HOLDING`);
                    }
                    file = await canvasHand(heldCards, heldCards.score);
                    i.editReply({ components: [hold_row, draw_row], embeds: [embed.setImage(`attachment://hand.png`)], files: [file] });
                    break;
                case 'draw':
                    for (let i = 0; i < 5; i++) {
                        if (!heldCards[i].hold) {
                            heldCards[i] = await drawCard(deck);
                        }
                    }
                    logger.debug(`${heldCards[0].code} | ${heldCards[1].code} | ${heldCards[2].code} | ${heldCards[3].code} | ${heldCards[4].code}`)
                    heldCards.score = await pokerScore(heldCards);
                    file = await canvasHand(heldCards, heldCards.score);
                    i.editReply({ components: [], embeds: [embed.setImage(`attachment://hand.png`)], files: [file] });
                    return collector.stop(heldCards.score);
                }
            logger.debug(`card1: ${heldCards[0].hold}, card2: ${heldCards[1].hold}, card3: ${heldCards[2].hold}, card4: ${heldCards[3].hold}, card5: ${heldCards[4].hold}`)
            collector.resetTimer();
        });
        collector.on('end', async (collected, reason) => {
            logger.debug(`Poker: Collected ${collected.size} interactions. Reason: ${reason}`);
            let winnings = Number(bet);
            await wait(1000);
            if (reason === 'time') {
                await db.add(`${stats}.losses`, 1);
                embed.setColor(0xFF0000)
                    .setTitle(`Time's up! You forfeit.`)
                    .setDescription(`You lost **${bet}** ${CURRENCY_NAME}.\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                await interaction.editReply({ components: [], embeds: [embed] });
                return;

            } else if (reason === 'Royal Flush') {
                winnings = Math.ceil(bet * 250);
                await db.add(`${user.id}.balance`, winnings);
                await db.add(`${stats}.wins`, 1);
                await db.add(`${stats}.royals`, 1);
                if (winnings > await db.get(`${stats}.biggestWin`)) {
                    await db.set(`${stats}.biggestWin`, winnings);
                }
                embed.setColor(0x00AE86)
                    .setTitle(`You got a Royal Flush!`)
                    .setDescription(`You won **${winnings}** ${CURRENCY_NAME}!\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                await interaction.editReply({ components: [], embeds: [embed] });
                await interaction.followUp({ content: `@everyone **${user.username}** just got a royal flush! Congratulations!`, allowedMentions: { parse: ['everyone'] }});
                return;
            } else if (reason === 'Straight Flush') {
                winnings = Math.ceil(bet * 50);
                await db.add(`${user.id}.balance`, winnings);
                await db.add(`${stats}.wins`, 1);
                if (winnings > await db.get(`${stats}.biggestWin`)) {
                    await db.set(`${stats}.biggestWin`, winnings);
                }
                embed.setColor(0x00AE86)
                    .setTitle(`You got a Straight Flush!`)
                    .setDescription(`You won **${winnings}** ${CURRENCY_NAME}!\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                await interaction.editReply({ components: [], embeds: [embed] });  
                return;
            } else if (reason === 'Four of a Kind') {
                winnings = Math.ceil(bet * 25);
                await db.add(`${user.id}.balance`, winnings);
                await db.add(`${stats}.wins`, 1);
                if (winnings > await db.get(`${stats}.biggestWin`)) {
                    await db.set(`${stats}.biggestWin`, winnings);
                }
                embed.setColor(0x00AE86)
                    .setTitle(`You got Four of a Kind!`)
                    .setDescription(`You won **${winnings}** ${CURRENCY_NAME}!\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                await interaction.editReply({ components: [], embeds: [embed] });
                return;
            } else if (reason === 'Full House') {
                winnings = Math.ceil(bet * 9);
                await db.add(`${user.id}.balance`, winnings);
                await db.add(`${stats}.wins`, 1);
                if (winnings > await db.get(`${stats}.biggestWin`)) {
                    await db.set(`${stats}.biggestWin`, winnings);
                }
                embed.setColor(0x00AE86)
                    .setTitle(`You got a Full House!`)
                    .setDescription(`You won **${winnings}** ${CURRENCY_NAME}!\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                await interaction.editReply({ components: [], embeds: [embed] });
                return;
            } else if (reason === 'Flush') {
                winnings = Math.ceil(bet * 6);
                await db.add(`${user.id}.balance`, winnings);
                await db.add(`${stats}.wins`, 1);
                if (winnings > await db.get(`${stats}.biggestWin`)) {
                    await db.set(`${stats}.biggestWin`, winnings);
                }
                embed.setColor(0x00AE86)
                    .setTitle(`You got a Flush!`)
                    .setDescription(`You won **${winnings}** ${CURRENCY_NAME}!\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                await interaction.editReply({ components: [], embeds: [embed] });
                return;
            } else if (reason === 'Straight') {
                winnings = Math.ceil(bet * 4);
                await db.add(`${user.id}.balance`, winnings);
                await db.add(`${stats}.wins`, 1);
                if (winnings > await db.get(`${stats}.biggestWin`)) {
                    await db.set(`${stats}.biggestWin`, winnings);
                }
                embed.setColor(0x00AE86)
                    .setTitle(`You got a Straight!`)
                    .setDescription(`You won **${winnings}** ${CURRENCY_NAME}!\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                await interaction.editReply({ components: [], embeds: [embed] });
                return;
            } else if (reason === 'Three of a Kind') {
                winnings = Math.ceil(bet * 3);
                await db.add(`${user.id}.balance`, winnings);
                await db.add(`${stats}.wins`, 1);
                if (winnings > await db.get(`${stats}.biggestWin`)) {
                    await db.set(`${stats}.biggestWin`, winnings);
                }
                embed.setColor(0x00AE86)
                    .setTitle(`You got Three of a Kind!`)
                    .setDescription(`You won **${winnings}** ${CURRENCY_NAME}!\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                await interaction.editReply({ components: [], embeds: [embed] });
                return;
            } else if (reason === 'Two Pair') {
                winnings = Math.ceil(bet * 2);
                await db.add(`${user.id}.balance`, winnings);
                await db.add(`${stats}.wins`, 1);
                if (winnings > await db.get(`${stats}.biggestWin`)) {
                    await db.set(`${stats}.biggestWin`, winnings);
                }
                embed.setColor(0x00AE86)
                    .setTitle(`You got Two Pair!`)
                    .setDescription(`You won **${winnings}** ${CURRENCY_NAME}!\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                await interaction.editReply({ components: [], embeds: [embed] });
                return;
            } else if (reason === 'Jacks or Better') {
                winnings = Math.ceil(bet * 1);
                await db.add(`${user.id}.balance`, winnings);
                await db.add(`${stats}.wins`, 1);
                if (winnings > await db.get(`${stats}.biggestWin`)) {
                    await db.set(`${stats}.biggestWin`, winnings);
                }
                embed.setColor(0x00AE86)
                    .setTitle(`You got a Pair of Jacks or Better!`)
                    .setDescription(`You won **${winnings}** ${CURRENCY_NAME}!\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                await interaction.editReply({ components: [], embeds: [embed] });
                return;
            } else {
                await db.add(`${stats}.losses`, 1);
                embed.setColor(0xFF0000)
                    .setTitle(`You lost!`)
                    .setDescription(`You lost **${bet}** ${CURRENCY_NAME}!\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                await interaction.editReply({ components: [], embeds: [embed] });
                return;
            }
        });
    }
}