const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Attachment, AttachmentBuilder } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const { addNewDBUser } = require("../../database");
const { CURRENCY_NAME } = require("../../config.js");
const { parseBet } = require('../../utils/betparse');
const wait = require('node:timers/promises').setTimeout;
const { shuffleDeck, newDeck, dealHand, drawCard } = require('../../utils/deckofcards');
const logger = require("../../utils/logger");
const { randomHexColor } = require('../../utils/randomcolor');
const { getCard, canvasHand, pokerScore } = require('../../utils/poker');
const { getJackpot, contributeToJackpot, winJackpot, isJackpotEligible, getJackpotDisplay, MIN_BET } = require('../../utils/jackpot');
const { getEquippedTheme } = require('../../themes/manager');
const { getThemeColors } = require('../../themes/resolver');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('poker')
        .setDescription(`Play a game of poker against the bot.`)
        .addStringOption(option => option.setName('bet').setDescription('The amount of money you want to bet.').setRequired(true)),
    async execute(interaction) {
        const user = interaction.user;
        const option = interaction.options.getString('bet');
        const stats = `${user.id}.stats.poker`;

        if (option === 'paytable') {
            const jackpot = await getJackpot();
            const paytable = new EmbedBuilder()
                .setAuthor({ name: interaction.user.displayName , iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
                .setColor(randomHexColor())
                .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp()
                .setTitle('Poker Paytable');
            paytable.addFields(
                { name: 'Hand', value: `
                    **Royal Flush** 🎰
                    Straight Flush
                    Four of a Kind
                    Full House
                    Flush
                    Straight
                    Three of a Kind
                    Two Pair
                    Jacks or Better`, inline: true },
                { name: 'Payout', value: `
                    **JACKPOT**
                    50x
                    25x
                    9x
                    6x
                    4x
                    3x
                    2x
                    1x`, inline: true }
            );
            paytable.addFields(
                { name: '🎰 Progressive Jackpot', value: `**${jackpot.amount.toLocaleString('en-US')} ${CURRENCY_NAME}**\nMinimum bet: ${MIN_BET.toLocaleString('en-US')} ${CURRENCY_NAME}`, inline: false }
            );
            return interaction.reply({ embeds: [paytable], ephemeral: true });
        }

        let bet = Number(await parseBet(option, user.id));
        const dbUser = await db.get(user.id);

        if (db.get(stats) === undefined) {
            db.set(stats, { wins: 0, losses: 0, royals: 0, biggestWin: 0, biggestLoss: 0 });
        }
        
        logger.log(`${user.username} (${user.id}) initialized a game of poker with a bet of ${bet} ${CURRENCY_NAME}.`);
        
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
        
        let msg = await interaction.deferReply(interaction);
        await db.sub(`${user.id}.balance`, bet);
        await contributeToJackpot(bet);

        // Resolve user's theme for canvas rendering
        const themeId = await getEquippedTheme(user.id);
        const pokerColors = getThemeColors(themeId, 'poker');

        const embed = new EmbedBuilder()
            .setAuthor({ name: user.displayName , iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setTitle(`Good luck!`)
            .setColor(randomHexColor())
            .setFooter({ text: `Bet: ${bet.toLocaleString('en-US')} ${CURRENCY_NAME} | ${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
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
        let file = await canvasHand(heldCards, heldCards.score, pokerColors);

        const draw_row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('draw')
                    .setLabel('Draw')
                    .setStyle(ButtonStyle.Success),
            );

        embed.setImage(`attachment://hand.png`);
        msg = await interaction.editReply({ embeds: [embed], components: [hold_row, draw_row], fetchReply: true, files: [file] });

        const PAYOUTS = {
            'Straight Flush':  { mult: 50, title: 'You got a Straight Flush!' },
            'Four of a Kind':  { mult: 25, title: 'You got Four of a Kind!' },
            'Full House':      { mult: 9,  title: 'You got a Full House!' },
            'Flush':           { mult: 6,  title: 'You got a Flush!' },
            'Straight':        { mult: 4,  title: 'You got a Straight!' },
            'Three of a Kind': { mult: 3,  title: 'You got Three of a Kind!' },
            'Two Pair':        { mult: 2,  title: 'You got Two Pair!' },
            'Jacks or Better': { mult: 1,  title: 'You got a Pair of Jacks or Better!' },
        };

        const applyWin = async (winnings, { isRoyal = false } = {}) => {
            await db.add(`${user.id}.balance`, winnings);
            await db.add(`${stats}.wins`, 1);
            if (isRoyal) await db.add(`${stats}.royals`, 1);
            await db.add(`${stats}.profit`, winnings - bet);
            if (winnings > await db.get(`${stats}.biggestWin`)) {
                await db.set(`${stats}.biggestWin`, winnings);
            }
            return (await db.get(`${user.id}.balance`)).toLocaleString('en-US');
        };

        const filter = i => i.user.id === user.id;
        const collector = msg.createMessageComponentCollector({ filter, time: 30000 });

        collector.on('collect', async i => {
            await i.deferUpdate();

            if (i.customId === 'draw') {
                for (let j = 0; j < 5; j++) {
                    if (!heldCards[j].hold) heldCards[j] = await drawCard(deck);
                }
                logger.debug(heldCards.map(c => c.code).join(' | '));
                heldCards.score = await pokerScore(heldCards);
                file = await canvasHand(heldCards, heldCards.score, pokerColors);
                i.editReply({ components: [], embeds: [embed.setImage(`attachment://hand.png`)], files: [file] });
                return collector.stop(heldCards.score);
            }

            const idx = Number(i.customId.slice(4)) - 1;
            const card = heldCards[idx];
            card.hold = !card.hold;
            hold_row.components[idx]
                .setStyle(card.hold ? ButtonStyle.Secondary : ButtonStyle.Primary)
                .setLabel(`${card.value} ${card.hold ? 'HOLDING' : 'HOLD'}`);
            file = await canvasHand(heldCards, heldCards.score, pokerColors);
            i.editReply({ components: [hold_row, draw_row], embeds: [embed.setImage(`attachment://hand.png`)], files: [file] });
            logger.debug(heldCards.map((c, k) => `card${k + 1}: ${c.hold}`).join(', '));
            collector.resetTimer();
        });

        collector.on('end', async (collected, reason) => {
            logger.debug(`Poker: Collected ${collected.size} interactions. Reason: ${reason}`);
            await wait(1000);

            if (reason === 'time') {
                await db.add(`${stats}.losses`, 1);
                await db.sub(`${stats}.profit`, bet);
                const balance = (await db.get(`${user.id}.balance`)).toLocaleString('en-US');
                embed.setColor(0xFF0000)
                    .setTitle(`Time's up! You forfeit.`)
                    .setDescription(`You lost **${bet.toLocaleString('en-US')}** ${CURRENCY_NAME}.\nYour new balance is **${balance}** ${CURRENCY_NAME}.`);
                return interaction.editReply({ components: [], embeds: [embed] });
            }

            if (reason === 'Royal Flush') {
                if (!isJackpotEligible(bet)) {
                    const winnings = Math.ceil(bet * 50);
                    const balance = await applyWin(winnings, { isRoyal: true });
                    embed.setColor(0x00AE86)
                        .setTitle(`You got a Royal Flush!`)
                        .setDescription(`You won **${winnings.toLocaleString('en-US')}** ${CURRENCY_NAME}! (Reduced payout - bet below ${MIN_BET.toLocaleString('en-US')} ${CURRENCY_NAME} for jackpot)\nYour new balance is **${balance}** ${CURRENCY_NAME}.`);
                    return interaction.editReply({ components: [], embeds: [embed] });
                }

                const jackpotResult = await winJackpot(user.id, user.displayName);
                const winnings = jackpotResult.amount;
                const balance = await applyWin(winnings, { isRoyal: true });
                embed.setColor(0xFFD700)
                    .setTitle(`🎰 JACKPOT! 🎰`)
                    .setDescription(`You got a Royal Flush and won the **Progressive Jackpot**!\nYou won **${winnings.toLocaleString('en-US')}** ${CURRENCY_NAME}!\nYour new balance is **${balance}** ${CURRENCY_NAME}.`);
                await interaction.editReply({ components: [], embeds: [embed] });
                await interaction.followUp({ content: `@everyone **${user.displayName}** just won the JACKPOT with a Royal Flush! 🎰 **${winnings.toLocaleString('en-US')}** ${CURRENCY_NAME}!`, allowedMentions: { parse: ['everyone'] }});
                return;
            }

            const payout = PAYOUTS[reason];
            if (payout) {
                const winnings = Math.ceil(bet * payout.mult);
                const balance = await applyWin(winnings);
                embed.setColor(0x00AE86)
                    .setTitle(payout.title)
                    .setDescription(`You won **${winnings.toLocaleString('en-US')}** ${CURRENCY_NAME}!\nYour new balance is **${balance}** ${CURRENCY_NAME}.`);
                return interaction.editReply({ components: [], embeds: [embed] });
            }

            await db.add(`${stats}.losses`, 1);
            await db.sub(`${stats}.profit`, bet);
            const balance = (await db.get(`${user.id}.balance`)).toLocaleString('en-US');
            embed.setColor(0xFF0000)
                .setTitle(`You lost!`)
                .setDescription(`You lost **${bet.toLocaleString('en-US')}** ${CURRENCY_NAME}!\nYour new balance is **${balance}** ${CURRENCY_NAME}.`);
            await interaction.editReply({ components: [], embeds: [embed] });
        });
    }
}