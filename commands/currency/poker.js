const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const wait = require("node:timers/promises").setTimeout;
const { addNewDBUser, db } = require("../../database");
const { CURRENCY_NAME } = require("../../config.js");
const { parseBet } = require("../../utils/betparse");
const { newDeck, dealHand, drawCard } = require("../../utils/cards");
const logger = require("../../utils/logger");
const { withUserLock } = require("../../utils/userlock");
const { canvasHand, pokerScore, drawPokerPaytable } = require("../../utils/poker");
const { getJackpot, contributeToJackpot, winJackpot, isJackpotEligible, MIN_BET } = require("../../utils/jackpot");
const { getEquippedTheme } = require("../../themes/manager");
const { getThemeColors } = require("../../themes/resolver");

const PAYOUTS = {
    "Straight Flush":  { mult: 50, title: "You got a Straight Flush!" },
    "Four of a Kind":  { mult: 25, title: "You got Four of a Kind!" },
    "Full House":      { mult: 9,  title: "You got a Full House!" },
    "Flush":           { mult: 6,  title: "You got a Flush!" },
    "Straight":        { mult: 4,  title: "You got a Straight!" },
    "Three of a Kind": { mult: 3,  title: "You got Three of a Kind!" },
    "Two Pair":        { mult: 2,  title: "You got Two Pair!" },
    "Jacks or Better": { mult: 1,  title: "You got a Pair of Jacks or Better!" },
};

// Theme tokens like textWin are stored as `#rrggbb` strings; Discord embeds
// need integers. embedColor is already an int in every theme.
function themeColor(c) {
    if (typeof c === "number") return c;
    if (!c) return 0;
    return parseInt(String(c).replace(/^#/, ""), 16) || 0;
}

function footer(interaction) {
    return {
        text: `${interaction.client.user.username} | Version ${require("../../package.json").version}`,
        iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }),
    };
}

function errorEmbed(interaction, themeColors, message) {
    return new EmbedBuilder()
        .setAuthor({ name: interaction.user.displayName, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
        .setColor(0xFF0000)
        .setDescription(message)
        .setFooter(footer(interaction))
        .setTimestamp();
}

async function showPaytable(interaction, themeColors) {
    const jackpot = await getJackpot();
    const attachment = await drawPokerPaytable(themeColors, {
        jackpotAmount: jackpot.amount,
        minBet: MIN_BET,
        currencyName: CURRENCY_NAME,
    });
    const embed = new EmbedBuilder()
        .setAuthor({ name: interaction.user.displayName, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
        .setColor(themeColors.embedColor || 0x0f4c25)
        .setImage("attachment://poker-paytable.png")
        .setFooter(footer(interaction))
        .setTimestamp();
    return interaction.reply({ embeds: [embed], files: [attachment] });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("poker")
        .setDescription("Play a game of video poker against the bot.")
        .addSubcommand(sub => sub
            .setName("play")
            .setDescription("Deal a new hand.")
            .addStringOption(opt => opt
                .setName("bet")
                .setDescription("The amount of koku you want to bet.")
                .setRequired(true)))
        .addSubcommand(sub => sub
            .setName("paytable")
            .setDescription("Show poker hand payouts.")),

    async execute(interaction) {
        const user = interaction.user;
        const themeId = await getEquippedTheme(user.id);
        const themeColors = getThemeColors(themeId, "poker");
        const sub = interaction.options.getSubcommand();

        if (sub === "paytable") {
            return showPaytable(interaction, themeColors);
        }

        const stats = `${user.id}.stats.poker`;
        const betInput = interaction.options.getString("bet");
        const bet = Number(await parseBet(betInput, user.id));

        const dbUser = await db.get(user.id);
        if (!dbUser) {
            await addNewDBUser(user);
            return interaction.reply({
                embeds: [errorEmbed(interaction, themeColors, "You don't have an account! Try `/daily` first.")],
                ephemeral: true,
            });
        }
        if (!Number.isFinite(bet) || bet < 1) {
            return interaction.reply({
                embeds: [errorEmbed(interaction, themeColors, `You must bet at least 1 ${CURRENCY_NAME}!`)],
                ephemeral: true,
            });
        }
        if (bet % 1 !== 0) {
            return interaction.reply({
                embeds: [errorEmbed(interaction, themeColors, "You must bet in whole numbers!")],
                ephemeral: true,
            });
        }

        // Atomic balance check + debit. Without the lock, two rapid poker
        // invocations could each pass the balance check before either subtracts.
        const debited = await withUserLock(user.id, async () => {
            const balance = await db.get(`${user.id}.balance`) ?? 0;
            if (balance < bet) return false;
            await db.sub(`${user.id}.balance`, bet);
            return true;
        });
        if (!debited) {
            return interaction.reply({
                embeds: [errorEmbed(interaction, themeColors, `You don't have enough ${CURRENCY_NAME}!`)],
                ephemeral: true,
            });
        }

        await contributeToJackpot(bet);
        logger.log(`${user.username} (${user.id}) initialized a game of poker with a bet of ${bet} ${CURRENCY_NAME}.`);

        await interaction.deferReply();

        const embed = new EmbedBuilder()
            .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setTitle("Good luck!")
            .setColor(themeColors.embedColor || 0x0f4c25)
            .setFooter({
                text: `Bet: ${bet.toLocaleString("en-US")} ${CURRENCY_NAME} | ${interaction.client.user.username} | Version ${require("../../package.json").version}`,
                iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }),
            })
            .setTimestamp()
            .setImage("attachment://hand.png");

        const deck = await newDeck();
        const heldCards = await dealHand(deck);
        logger.debug(heldCards.map(c => c.code).join(" | "));

        const holdRow = new ActionRowBuilder().addComponents(
            ...heldCards.map((c, i) => new ButtonBuilder()
                .setCustomId(`card${i + 1}`)
                .setLabel(`${c.value} HOLD`)
                .setStyle(ButtonStyle.Primary)
                .setEmoji(c.emoji)),
        );
        const drawRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("draw").setLabel("Draw").setStyle(ButtonStyle.Success),
        );

        let file = await canvasHand(heldCards, null, themeColors, themeId, { user });
        const msg = await interaction.editReply({ embeds: [embed], components: [holdRow, drawRow], files: [file] });

        const applyWin = async (winnings, { isRoyal = false } = {}) => {
            await withUserLock(user.id, () => db.add(`${user.id}.balance`, winnings));
            await db.add(`${stats}.wins`, 1);
            if (isRoyal) await db.add(`${stats}.royals`, 1);
            await db.add(`${stats}.profit`, winnings - bet);
            const currentBiggest = await db.get(`${stats}.biggestWin`) ?? 0;
            if (winnings > currentBiggest) await db.set(`${stats}.biggestWin`, winnings);
            return (await db.get(`${user.id}.balance`)).toLocaleString("en-US");
        };

        const applyLoss = async () => {
            await db.add(`${stats}.losses`, 1);
            await db.sub(`${stats}.profit`, bet);
            const currentBiggestLoss = await db.get(`${stats}.biggestLoss`) ?? 0;
            if (bet > currentBiggestLoss) await db.set(`${stats}.biggestLoss`, bet);
            return (await db.get(`${user.id}.balance`)).toLocaleString("en-US");
        };

        const collector = msg.createMessageComponentCollector({
            filter: i => i.user.id === user.id,
            time: 30000,
        });

        collector.on("collect", async i => {
            await i.deferUpdate();

            if (i.customId === "draw") {
                for (let j = 0; j < 5; j++) {
                    if (!heldCards[j].hold) heldCards[j] = await drawCard(deck);
                }
                logger.debug(heldCards.map(c => c.code).join(" | "));
                heldCards.score = await pokerScore(heldCards);
                const finalOutcome = heldCards.score ? "win" : "loss";
                file = await canvasHand(heldCards, heldCards.score, themeColors, themeId, { user, outcome: finalOutcome });
                await i.editReply({ components: [], embeds: [embed], files: [file] });
                return collector.stop(heldCards.score || "no-score");
            }

            const idx = Number(i.customId.slice(4)) - 1;
            const card = heldCards[idx];
            card.hold = !card.hold;
            holdRow.components[idx]
                .setStyle(card.hold ? ButtonStyle.Secondary : ButtonStyle.Primary)
                .setLabel(`${card.value} ${card.hold ? "HOLDING" : "HOLD"}`);
            file = await canvasHand(heldCards, null, themeColors, themeId, { user });
            await i.editReply({ components: [holdRow, drawRow], embeds: [embed], files: [file] });
            collector.resetTimer();
        });

        collector.on("end", async (collected, reason) => {
            logger.debug(`Poker: Collected ${collected.size} interactions. Reason: ${reason}`);
            await wait(1000);

            if (reason === "time") {
                const balance = await applyLoss();
                embed.setColor(themeColor(themeColors.textLoss) || 0xFF0000)
                    .setTitle("Time's up! You forfeit.")
                    .setDescription(`You lost **${bet.toLocaleString("en-US")}** ${CURRENCY_NAME}.\nYour new balance is **${balance}** ${CURRENCY_NAME}.`);
                return interaction.editReply({ components: [], embeds: [embed] });
            }

            if (reason === "Royal Flush") {
                if (!isJackpotEligible(bet)) {
                    const winnings = Math.ceil(bet * 50);
                    const balance = await applyWin(winnings, { isRoyal: true });
                    embed.setColor(themeColor(themeColors.textWin) || 0x00AE86)
                        .setTitle("You got a Royal Flush!")
                        .setDescription(`You won **${winnings.toLocaleString("en-US")}** ${CURRENCY_NAME}! (Reduced payout — bet below ${MIN_BET.toLocaleString("en-US")} ${CURRENCY_NAME} for jackpot)\nYour new balance is **${balance}** ${CURRENCY_NAME}.`);
                    return interaction.editReply({ components: [], embeds: [embed] });
                }

                const jackpotResult = await winJackpot(user.id, user.displayName);
                const winnings = jackpotResult.amount;
                const balance = await applyWin(winnings, { isRoyal: true });
                embed.setColor(themeColor(themeColors.gold) || 0xFFD700)
                    .setTitle("🎰 JACKPOT! 🎰")
                    .setDescription(`You got a Royal Flush and won the **Progressive Jackpot**!\nYou won **${winnings.toLocaleString("en-US")}** ${CURRENCY_NAME}!\nYour new balance is **${balance}** ${CURRENCY_NAME}.`);
                await interaction.editReply({ components: [], embeds: [embed] });
                await interaction.followUp({
                    content: `@everyone **${user.displayName}** just won the JACKPOT with a Royal Flush! 🎰 **${winnings.toLocaleString("en-US")}** ${CURRENCY_NAME}!`,
                    allowedMentions: { parse: ["everyone"] },
                });
                return;
            }

            const payout = PAYOUTS[reason];
            if (payout) {
                const winnings = Math.ceil(bet * payout.mult);
                const balance = await applyWin(winnings);
                embed.setColor(themeColor(themeColors.textWin) || 0x00AE86)
                    .setTitle(payout.title)
                    .setDescription(`You won **${winnings.toLocaleString("en-US")}** ${CURRENCY_NAME}!\nYour new balance is **${balance}** ${CURRENCY_NAME}.`);
                return interaction.editReply({ components: [], embeds: [embed] });
            }

            const balance = await applyLoss();
            embed.setColor(themeColor(themeColors.textLoss) || 0xFF0000)
                .setTitle("You lost!")
                .setDescription(`You lost **${bet.toLocaleString("en-US")}** ${CURRENCY_NAME}.\nYour new balance is **${balance}** ${CURRENCY_NAME}.`);
            await interaction.editReply({ components: [], embeds: [embed] });
        });
    },
};
