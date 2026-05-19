const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require("discord.js");
const wait = require("node:timers/promises").setTimeout;
const { addNewDBUser, db } = require("../../database");
const { CURRENCY_NAME, PANEL_IDLE_TIMEOUT } = require("../../config.js");
const { parseBet } = require("../../utils/betparse");
const { openBetModal, resolveBet } = require("../../utils/betModal");
const { newDeck, dealHand, drawCard } = require("../../utils/cards");
const logger = require("../../utils/logger");
const { withUserLock } = require("../../utils/userlock");
const { canvasHand, pokerScore, drawPokerPaytable } = require("../../utils/poker");
const { getJackpot, contributeToJackpot, winJackpot, isJackpotEligible, MIN_BET } = require("../../utils/jackpot");
const { getEquippedTheme } = require("../../themes/manager");
const { getThemeColors } = require("../../themes/resolver");

const PACKAGE_VERSION = require("../../package.json").version;
const HAND_TIMEOUT_MS = 30000;

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

function footer(client) {
    return {
        text: `${client.user.username} | Version ${PACKAGE_VERSION}`,
        iconURL: client.user.displayAvatarURL({ dynamic: true }),
    };
}

function errorEmbed(user, client, message) {
    return new EmbedBuilder()
        .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
        .setColor(0xFF0000)
        .setDescription(message)
        .setFooter(footer(client))
        .setTimestamp();
}

function sessionKey(channelId, userId) {
    return `${channelId}:${userId}`;
}

// ─── paytable (shared between slash subcommand and hub button) ───────────────

async function buildPaytablePayload(user, client, themeColors) {
    const jackpot = await getJackpot();
    const attachment = await drawPokerPaytable(themeColors, {
        jackpotAmount: jackpot.amount,
        minBet: MIN_BET,
        currencyName: CURRENCY_NAME,
    });
    const embed = new EmbedBuilder()
        .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
        .setColor(themeColors.embedColor || 0x0f4c25)
        .setImage("attachment://poker-paytable.png")
        .setFooter(footer(client))
        .setTimestamp();
    return { embeds: [embed], files: [attachment] };
}

// ─── hub components / embed ──────────────────────────────────────────────────

function buildHubComponents(hasLastBet, disabled = false) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("poker_deal")
            .setLabel(hasLastBet ? "Deal Again" : "Deal")
            .setEmoji("🃏")
            .setStyle(ButtonStyle.Success)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId("poker_change_bet")
            .setLabel("Change Bet")
            .setEmoji("💰")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId("poker_paytable")
            .setLabel("Paytable")
            .setEmoji("📜")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId("poker_leave")
            .setLabel("Leave Table")
            .setEmoji("🚪")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disabled),
    );
    return [row];
}

function buildHubEmbed(user, client, balance, lastHandDesc, themeColors) {
    const embed = new EmbedBuilder()
        .setAuthor({ name: `${user.displayName}'s table`, iconURL: user.displayAvatarURL?.({ dynamic: true }) || undefined })
        .setColor(themeColors?.embedColor || 0x0f4c25)
        .setFooter(footer(client))
        .setTimestamp();
    const balLine = `Balance: **${balance.toLocaleString("en-US")}** ${CURRENCY_NAME}`;
    embed.setDescription(lastHandDesc ? `${lastHandDesc}\n\n${balLine}` : balLine);
    return embed;
}

// ─── session lifecycle ───────────────────────────────────────────────────────

function createSession(userId, channelId, key, messageId, startBalance) {
    return {
        userId,
        channelId,
        key,
        messageId,
        lastBet: null,
        lastBetExpression: null,
        handCounter: 0,
        status: "waiting", // "waiting" | "playing" | "ended"
        collector: null,
        startBalance,
        rounds: 0,
        wins: 0,
        losses: 0,
        royals: 0,
        bestHand: null,
        totalWagered: 0,
        totalReturned: 0,
        biggestWin: 0,
        biggestLoss: 0,
    };
}

async function openHubPanel(interaction, user, client) {
    const key = sessionKey(interaction.channelId, user.id);
    const existing = client.pokerTables.get(key);
    if (existing && existing.status !== "ended") {
        return interaction.reply({
            embeds: [errorEmbed(user, client, "You already have a poker table open in this channel. Use the buttons on your existing table.")],
            ephemeral: true,
        });
    }

    let dbUser = await db.get(user.id);
    if (!dbUser) {
        await addNewDBUser(user);
        dbUser = await db.get(user.id);
    }

    const themeId = await getEquippedTheme(user.id);
    const themeColors = getThemeColors(themeId, "poker");
    const balance = dbUser?.balance ?? 0;
    const cachedExpression = (await db.get(`${user.id}.poker.lastBet`)) || null;

    const embed = buildHubEmbed(user, client, balance, null, themeColors);
    embed.setTitle("Video Poker — click Deal to start");
    const idleAttachment = await canvasHand(
        Array.from({ length: 5 }, () => ({ code: "back", hold: false })),
        null,
        themeColors,
        themeId,
        { user, faceDown: true, idle: true },
    );
    if (idleAttachment) embed.setImage("attachment://hand.png");

    await interaction.deferReply();
    // hasLastBet controls the Deal vs. Deal Again label; until a hand has
    // resolved in this session the button always reads "Deal" even if a
    // cached bet expression exists from a prior session.
    const message = await interaction.editReply({
        embeds: [embed],
        components: buildHubComponents(false),
        files: idleAttachment ? [idleAttachment] : [],
    });

    const session = createSession(user.id, interaction.channelId, key, message.id, balance);
    session.lastBetExpression = cachedExpression;
    client.pokerTables.set(key, session);
    attachSessionCollector(client, message, session, interaction.channel);
}

function attachSessionCollector(client, message, session, channel) {
    if (session.collector) {
        try { session.collector.stop("replaced"); } catch (_) {}
    }

    const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => i.user.id === session.userId && ["poker_deal", "poker_change_bet", "poker_paytable", "poker_leave"].includes(i.customId),
        idle: PANEL_IDLE_TIMEOUT,
    });
    session.collector = collector;

    collector.on("collect", async (i) => {
        try {
            if (session.status !== "waiting") {
                return i.deferUpdate().catch(() => {});
            }
            if (i.customId === "poker_deal") {
                return handleDeal(i, session, client, channel);
            }
            if (i.customId === "poker_change_bet") {
                return handleChangeBet(i, session, client);
            }
            if (i.customId === "poker_paytable") {
                return handlePaytableButton(i, session, client);
            }
            if (i.customId === "poker_leave") {
                return endSession(client, message, session, "ended", i);
            }
        } catch (err) {
            logger.error(`[poker] collector error: ${err && err.stack || err}`);
            try {
                if (!i.replied && !i.deferred) await i.reply({ content: "Something went wrong.", ephemeral: true });
            } catch (_) {}
        }
    });

    collector.on("end", async (_collected, reason) => {
        if (!client.pokerTables.has(session.key)) return;
        if (reason === "idle" || reason === "time") {
            const current = client.pokerTables.get(session.key);
            if (current && current.status === "playing") return;
            await endSession(client, message, session, "idle", null);
        }
    });
}

async function endSession(client, message, session, reason, interaction) {
    if (!client.pokerTables.has(session.key)) return;
    if (session.status === "ended") return;
    session.status = "ended";
    client.pokerTables.delete(session.key);
    if (session.collector) {
        try { session.collector.stop(reason); } catch (_) {}
    }

    const user = interaction?.user ?? { displayName: "Player", displayAvatarURL: () => null, id: session.userId };
    const embed = await buildSessionSummaryEmbed(user, client, session, reason);

    try {
        if (interaction && !interaction.replied && !interaction.deferred) {
            await interaction.update({ embeds: [embed], components: [], files: [] });
        } else if (interaction && interaction.deferred) {
            await interaction.editReply({ embeds: [embed], components: [], files: [] });
        } else {
            await message.edit({ embeds: [embed], components: [], files: [] });
        }
    } catch (_) {}
}

async function buildSessionSummaryEmbed(user, client, session, reason) {
    const newBalance = (await db.get(`${session.userId}.balance`)) ?? 0;
    const netProfit = session.totalReturned - session.totalWagered;
    const handsPlayed = session.wins + session.losses;
    const winPct = handsPlayed > 0 ? (session.wins / handsPlayed) * 100 : 0;

    const profitLine = netProfit > 0
        ? `🟢 **+${netProfit.toLocaleString("en-US")}** ${CURRENCY_NAME}`
        : netProfit < 0
            ? `🔴 **${netProfit.toLocaleString("en-US")}** ${CURRENCY_NAME}`
            : `⚪ **0** ${CURRENCY_NAME}`;
    const color = netProfit > 0 ? 0x00AE86 : netProfit < 0 ? 0xFF0000 : 0xAAAAAA;

    const headline = reason === "idle"
        ? "Session ended due to inactivity."
        : "You left the table.";

    const embed = new EmbedBuilder()
        .setAuthor({ name: `${user.displayName}'s Poker summary`, iconURL: user.displayAvatarURL?.({ dynamic: true }) || undefined })
        .setColor(color)
        .setDescription(headline)
        .addFields(
            { name: "Hands", value: `**${handsPlayed.toLocaleString("en-US")}** (${session.wins.toLocaleString("en-US")}W / ${session.losses.toLocaleString("en-US")}L)`, inline: true },
            { name: "Win Rate", value: handsPlayed > 0 ? `**${winPct.toFixed(1)}%**` : "—", inline: true },
            { name: "Best Hand", value: session.bestHand ? `**${session.bestHand.name}** (+${session.bestHand.winnings.toLocaleString("en-US")} ${CURRENCY_NAME})` : "—", inline: true },
            { name: "Wagered", value: `**${session.totalWagered.toLocaleString("en-US")}** ${CURRENCY_NAME}`, inline: true },
            { name: "Returned", value: `**${session.totalReturned.toLocaleString("en-US")}** ${CURRENCY_NAME}`, inline: true },
            { name: "Net Profit", value: profitLine, inline: true },
            { name: " ", value: " ", inline: false },
            { name: "Current Balance", value: `**${newBalance.toLocaleString("en-US")}** ${CURRENCY_NAME}`, inline: false },
        )
        .setFooter(footer(client))
        .setTimestamp();

    return embed;
}

// ─── hub button handlers ─────────────────────────────────────────────────────

async function handlePaytableButton(buttonInt, session, client) {
    const themeId = await getEquippedTheme(session.userId);
    const themeColors = getThemeColors(themeId, "poker");
    const payload = await buildPaytablePayload(buttonInt.user, client, themeColors);
    return buttonInt.reply({ ...payload, ephemeral: true });
}

async function handleChangeBet(buttonInt, session, client) {
    const user = buttonInt.user;
    const result = await openBetModal(buttonInt, {
        title: "Change your poker bet",
        placeholder: "e.g. 100, half, max",
        defaultAmount: session.lastBetExpression || undefined,
    });
    if (!result) return;
    const { amount, expression, submit } = result;

    const current = client.pokerTables.get(session.key);
    if (!current || current.status === "ended") {
        return submit.reply({ embeds: [errorEmbed(user, client, "Your table is no longer active.")], ephemeral: true });
    }
    current.lastBet = amount;
    current.lastBetExpression = expression;
    await db.set(`${user.id}.poker.lastBet`, expression).catch(() => {});

    return submit.reply({
        embeds: [new EmbedBuilder()
            .setColor(0x0f4c25)
            .setDescription(`Default bet updated to **${amount.toLocaleString("en-US")}** ${CURRENCY_NAME}. Click **Deal Again** to use it.`)
            .setTimestamp()],
        ephemeral: true,
    });
}

async function handleDeal(buttonInt, session, client, channel) {
    const user = buttonInt.user;

    if (session.lastBetExpression) {
        const resolved = await resolveBet(session.lastBetExpression, user.id);
        if (!resolved.ok) {
            session.lastBetExpression = null;
            return buttonInt.reply({
                embeds: [errorEmbed(user, client, `${resolved.reason} Click **Deal** again to enter a new bet.`)],
                ephemeral: true,
            });
        }
        return dealWithAmount(buttonInt, session, client, channel, user, resolved.amount, /* deferUpdate */ true);
    }

    const result = await openBetModal(buttonInt, {
        title: "Place your poker bet",
        placeholder: "e.g. 100, half, max",
    });
    if (!result) return;
    const { amount, expression, submit } = result;
    session.lastBetExpression = expression;
    await db.set(`${user.id}.poker.lastBet`, expression).catch(() => {});
    return dealWithAmount(submit, session, client, channel, user, amount, /* deferUpdate */ true);
}

async function dealWithAmount(interaction, session, client, channel, user, amount, deferUpdate) {
    const current = client.pokerTables.get(session.key);
    if (!current || current.status !== "waiting") {
        return interaction.reply({ embeds: [errorEmbed(user, client, "Your table is no longer available.")], ephemeral: true });
    }

    if (amount % 1 !== 0) {
        return interaction.reply({ embeds: [errorEmbed(user, client, "You must bet in whole numbers!")], ephemeral: true });
    }

    const debited = await withUserLock(user.id, async () => {
        const bal = (await db.get(`${user.id}.balance`)) ?? 0;
        if (bal < amount) return false;
        await db.sub(`${user.id}.balance`, amount);
        return true;
    });
    if (!debited) {
        return interaction.reply({ embeds: [errorEmbed(user, client, `You don't have enough ${CURRENCY_NAME}!`)], ephemeral: true });
    }
    await contributeToJackpot(amount);

    current.lastBet = amount;
    current.status = "playing";

    if (deferUpdate) await interaction.deferUpdate().catch(() => {});

    try {
        const msg = await channel.messages.fetch(current.messageId);
        await runHand(user, client, current, amount, msg, channel);
    } catch (err) {
        logger.error(`[poker] runHand error: ${err && err.stack || err}`);
        current.status = "waiting";
    }
}

// ─── core hand logic ─────────────────────────────────────────────────────────

async function runHand(user, client, session, bet, message, channel) {
    const stats = `${user.id}.stats.poker`;
    const themeId = await getEquippedTheme(user.id);
    const themeColors = getThemeColors(themeId, "poker");
    const handId = ++session.handCounter;

    session.rounds += 1;
    session.totalWagered += bet;

    logger.log(`${user.username} (${user.id}) dealt poker hand #${handId} with bet ${bet} ${CURRENCY_NAME}.`);

    // Disable hub while hand plays
    await message.edit({ components: buildHubComponents(true, /* disabled */ true) }).catch(() => {});

    const deck = await newDeck();
    const heldCards = await dealHand(deck);
    logger.debug(heldCards.map(c => c.code).join(" | "));

    const handPrefix = `pk_h${handId}_`;
    const holdRow = new ActionRowBuilder().addComponents(
        ...heldCards.map((c, i) => new ButtonBuilder()
            .setCustomId(`${handPrefix}card${i + 1}`)
            .setLabel(`${c.value} HOLD`)
            .setStyle(ButtonStyle.Primary)
            .setEmoji(c.emoji)),
    );
    const drawRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${handPrefix}draw`).setLabel("Draw").setStyle(ButtonStyle.Success),
    );

    const embed = new EmbedBuilder()
        .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
        .setTitle("Good luck!")
        .setColor(themeColors.embedColor || 0x0f4c25)
        .setFooter({
            text: `Bet: ${bet.toLocaleString("en-US")} ${CURRENCY_NAME} | ${client.user.username} | Version ${PACKAGE_VERSION}`,
            iconURL: client.user.displayAvatarURL({ dynamic: true }),
        })
        .setTimestamp()
        .setImage("attachment://hand.png");

    // Compute score on the initial deal so the score pill displays immediately
    // when the player is dealt a winning combination — they can spot it before
    // deciding what to hold rather than discovering it post-draw.
    heldCards.score = await pokerScore(heldCards);
    let file = await canvasHand(heldCards, heldCards.score, themeColors, themeId, { user });
    await message.edit({ embeds: [embed], components: [holdRow, drawRow], files: [file] });

    const applyWin = async (winnings, { isRoyal = false, handName = null } = {}) => {
        await withUserLock(user.id, () => db.add(`${user.id}.balance`, winnings));
        await db.add(`${stats}.wins`, 1);
        if (isRoyal) await db.add(`${stats}.royals`, 1);
        await db.add(`${stats}.profit`, winnings - bet);
        const currentBiggest = (await db.get(`${stats}.biggestWin`)) ?? 0;
        if (winnings > currentBiggest) await db.set(`${stats}.biggestWin`, winnings);
        session.wins += 1;
        if (isRoyal) session.royals += 1;
        session.totalReturned += winnings;
        if (winnings > session.biggestWin) session.biggestWin = winnings;
        if (handName && winnings > (session.bestHand?.winnings ?? 0)) {
            session.bestHand = { name: handName, winnings };
        }
        return ((await db.get(`${user.id}.balance`)) ?? 0).toLocaleString("en-US");
    };

    const applyLoss = async () => {
        await db.add(`${stats}.losses`, 1);
        await db.sub(`${stats}.profit`, bet);
        const currentBiggestLoss = (await db.get(`${stats}.biggestLoss`)) ?? 0;
        if (bet > currentBiggestLoss) await db.set(`${stats}.biggestLoss`, bet);
        session.losses += 1;
        if (bet > session.biggestLoss) session.biggestLoss = bet;
        return ((await db.get(`${user.id}.balance`)) ?? 0).toLocaleString("en-US");
    };

    // Mid-hand collector — namespaced so a stale click from a previous hand
    // can never land here, and filtered to the dealing user only.
    const handCollector = message.createMessageComponentCollector({
        filter: i => i.user.id === user.id && i.customId.startsWith(handPrefix),
        time: HAND_TIMEOUT_MS,
    });

    handCollector.on("collect", async (i) => {
        try {
            await i.deferUpdate();
            const tail = i.customId.slice(handPrefix.length);

            if (tail === "draw") {
                for (let j = 0; j < 5; j++) {
                    if (!heldCards[j].hold) heldCards[j] = await drawCard(deck);
                }
                logger.debug(heldCards.map(c => c.code).join(" | "));
                heldCards.score = await pokerScore(heldCards);
                // Reveal the final hand face-up with NO win/lose overlay first.
                // The end handler renders the overlay on the result embed after
                // a beat so the player sees the cards clean before the verdict.
                file = await canvasHand(heldCards, heldCards.score, themeColors, themeId, { user });
                embed.setTitle("Final hand");
                embed.setDescription(null);
                await message.edit({ components: [], embeds: [embed], files: [file] }).catch(() => {});
                return handCollector.stop(heldCards.score || "no-score");
            }

            const idx = Number(tail.slice(4)) - 1;
            const card = heldCards[idx];
            card.hold = !card.hold;
            holdRow.components[idx]
                .setStyle(card.hold ? ButtonStyle.Secondary : ButtonStyle.Primary)
                .setLabel(`${card.value} ${card.hold ? "HOLDING" : "HOLD"}`);
            // Keep the initial-deal score pill visible while the player toggles
            // holds — the score reflects the un-drawn hand they currently have.
            file = await canvasHand(heldCards, heldCards.score, themeColors, themeId, { user });
            await message.edit({ components: [holdRow, drawRow], embeds: [embed], files: [file] }).catch(() => {});
            handCollector.resetTimer();
        } catch (err) {
            logger.error(`[poker] hand-button error: ${err && err.stack || err}`);
        }
    });

    handCollector.on("end", async (_collected, reason) => {
        logger.debug(`Poker hand #${handId}: end reason ${reason}`);
        // Beat between clean reveal and verdict so the player gets a moment
        // to read the final hand before the win/lose overlay lands.
        await wait(1400);

        let finalFile = null;

        if (reason === "time") {
            // Forfeit before drawing — no clean reveal happened, so render the
            // pre-draw hand with the loss overlay for the verdict embed.
            finalFile = await canvasHand(heldCards, null, themeColors, themeId, { user, outcome: "loss" });
            const balance = await applyLoss();
            embed.setColor(themeColor(themeColors.textLoss) || 0xFF0000)
                .setTitle("Time's up! You forfeit.")
                .setDescription(`You lost **${bet.toLocaleString("en-US")}** ${CURRENCY_NAME}.\nYour new balance is **${balance}** ${CURRENCY_NAME}.`)
                .setImage("attachment://hand.png");
            await message.edit({ components: buildHubComponents(true), embeds: [embed], files: [finalFile] }).catch(err => logger.error(`[poker] verdict edit failed: ${err && err.stack || err}`));
        } else if (reason === "Royal Flush") {
            finalFile = await canvasHand(heldCards, heldCards.score, themeColors, themeId, { user, outcome: "win" });
            if (!isJackpotEligible(bet)) {
                const winnings = Math.ceil(bet * 50);
                const balance = await applyWin(winnings, { isRoyal: true, handName: "Royal Flush" });
                embed.setColor(themeColor(themeColors.textWin) || 0x00AE86)
                    .setTitle("You got a Royal Flush!")
                    .setDescription(`You won **${winnings.toLocaleString("en-US")}** ${CURRENCY_NAME}! (Reduced payout — bet below ${MIN_BET.toLocaleString("en-US")} ${CURRENCY_NAME} for jackpot)\nYour new balance is **${balance}** ${CURRENCY_NAME}.`)
                    .setImage("attachment://hand.png");
                await message.edit({ components: buildHubComponents(true), embeds: [embed], files: [finalFile] }).catch(err => logger.error(`[poker] verdict edit failed: ${err && err.stack || err}`));
            } else {
                const jackpotResult = await winJackpot(user.id, user.displayName);
                const winnings = jackpotResult.amount;
                const balance = await applyWin(winnings, { isRoyal: true, handName: "Royal Flush (Jackpot)" });
                embed.setColor(themeColor(themeColors.gold) || 0xFFD700)
                    .setTitle("🎰 JACKPOT! 🎰")
                    .setDescription(`You got a Royal Flush and won the **Progressive Jackpot**!\nYou won **${winnings.toLocaleString("en-US")}** ${CURRENCY_NAME}!\nYour new balance is **${balance}** ${CURRENCY_NAME}.`)
                    .setImage("attachment://hand.png");
                await message.edit({ components: buildHubComponents(true), embeds: [embed], files: [finalFile] }).catch(err => logger.error(`[poker] verdict edit failed: ${err && err.stack || err}`));
                try {
                    await channel.send({
                        content: `@everyone **${user.displayName}** just won the JACKPOT with a Royal Flush! 🎰 **${winnings.toLocaleString("en-US")}** ${CURRENCY_NAME}!`,
                        allowedMentions: { parse: ["everyone"] },
                    });
                } catch (err) {
                    logger.warn(`[poker] failed to send jackpot announcement: ${err.message}`);
                }
            }
        } else {
            const payout = PAYOUTS[reason];
            if (payout) {
                finalFile = await canvasHand(heldCards, heldCards.score, themeColors, themeId, { user, outcome: "win" });
                const winnings = Math.ceil(bet * payout.mult);
                const balance = await applyWin(winnings, { handName: reason });
                embed.setColor(themeColor(themeColors.textWin) || 0x00AE86)
                    .setTitle(payout.title)
                    .setDescription(`You won **${winnings.toLocaleString("en-US")}** ${CURRENCY_NAME}!\nYour new balance is **${balance}** ${CURRENCY_NAME}.`)
                    .setImage("attachment://hand.png");
                await message.edit({ components: buildHubComponents(true), embeds: [embed], files: [finalFile] }).catch(err => logger.error(`[poker] verdict edit failed: ${err && err.stack || err}`));
            } else {
                finalFile = await canvasHand(heldCards, heldCards.score, themeColors, themeId, { user, outcome: "loss" });
                const balance = await applyLoss();
                embed.setColor(themeColor(themeColors.textLoss) || 0xFF0000)
                    .setTitle("You lost!")
                    .setDescription(`You lost **${bet.toLocaleString("en-US")}** ${CURRENCY_NAME}.\nYour new balance is **${balance}** ${CURRENCY_NAME}.`)
                    .setImage("attachment://hand.png");
                await message.edit({ components: buildHubComponents(true), embeds: [embed], files: [finalFile] }).catch(err => logger.error(`[poker] verdict edit failed: ${err && err.stack || err}`));
            }
        }

        // Hub buttons (Deal Again / Change Bet / Paytable / Leave) are already
        // attached to the verdict embed above. Just re-arm the outer collector
        // so the idle timer resets and the next round can begin.
        const current = client.pokerTables.get(session.key);
        if (current && current.status !== "ended") {
            current.status = "waiting";
            attachSessionCollector(client, message, current, channel);
        }
    });
}

// ─── command entry point ─────────────────────────────────────────────────────

module.exports = {
    data: new SlashCommandBuilder()
        .setName("poker")
        .setDescription("Play a game of video poker against the bot.")
        .addSubcommand(sub => sub
            .setName("play")
            .setDescription("Open the poker table panel (or fast-deal a hand with bet).")
            .addStringOption(opt => opt
                .setName("bet")
                .setDescription(`Optional ${CURRENCY_NAME} bet for an immediate deal (omit to just open the panel).`)
                .setRequired(false)))
        .addSubcommand(sub => sub
            .setName("paytable")
            .setDescription("Show poker hand payouts.")),

    async execute(interaction) {
        const user = interaction.user;
        const client = interaction.client;
        const sub = interaction.options.getSubcommand();

        if (sub === "paytable") {
            const themeId = await getEquippedTheme(user.id);
            const themeColors = getThemeColors(themeId, "poker");
            const payload = await buildPaytablePayload(user, client, themeColors);
            return interaction.reply(payload);
        }

        const betOption = interaction.options.getString("bet");

        // No bet → open the hub.
        if (!betOption) {
            return openHubPanel(interaction, user, client);
        }

        // Fast path: bet provided → open hub then deal immediately.
        const key = sessionKey(interaction.channelId, user.id);
        const existing = client.pokerTables.get(key);
        if (existing && existing.status !== "ended") {
            return interaction.reply({
                embeds: [errorEmbed(user, client, "You already have a poker table open in this channel. Use the buttons on your existing message.")],
                ephemeral: true,
            });
        }

        let dbUser = await db.get(user.id);
        if (!dbUser) {
            await addNewDBUser(user);
            dbUser = await db.get(user.id);
        }

        const bet = Number(await parseBet(betOption, user.id));
        const themeId = await getEquippedTheme(user.id);
        const themeColors = getThemeColors(themeId, "poker");

        if (!Number.isFinite(bet) || bet < 1) {
            return interaction.reply({
                embeds: [errorEmbed(user, client, `You must bet at least 1 ${CURRENCY_NAME}!`)],
                ephemeral: true,
            });
        }
        if (bet % 1 !== 0) {
            return interaction.reply({
                embeds: [errorEmbed(user, client, "You must bet in whole numbers!")],
                ephemeral: true,
            });
        }
        if (bet > (dbUser.balance ?? 0)) {
            return interaction.reply({ embeds: [errorEmbed(user, client, `You don't have enough ${CURRENCY_NAME}!`)], ephemeral: true });
        }

        await interaction.deferReply();

        const startBalance = dbUser.balance ?? 0;
        const hubEmbed = buildHubEmbed(user, client, startBalance, null, themeColors);
        hubEmbed.setTitle("Video Poker — dealing your hand...");
        const message = await interaction.editReply({
            embeds: [hubEmbed],
            components: buildHubComponents(true, /* disabled */ true),
        });

        const session = createSession(user.id, interaction.channelId, key, message.id, startBalance);
        session.lastBetExpression = betOption.trim();
        client.pokerTables.set(key, session);
        await db.set(`${user.id}.poker.lastBet`, betOption.trim()).catch(() => {});

        // Debit + start hand
        const debited = await withUserLock(user.id, async () => {
            const bal = (await db.get(`${user.id}.balance`)) ?? 0;
            if (bal < bet) return false;
            await db.sub(`${user.id}.balance`, bet);
            return true;
        });
        if (!debited) {
            client.pokerTables.delete(key);
            return interaction.editReply({ embeds: [errorEmbed(user, client, `You don't have enough ${CURRENCY_NAME}!`)], components: [] });
        }
        await contributeToJackpot(bet);
        session.lastBet = bet;
        session.status = "playing";

        try {
            await runHand(user, client, session, bet, message, interaction.channel);
        } catch (err) {
            logger.error(`[poker] fast-path runHand error: ${err && err.stack || err}`);
            session.status = "waiting";
            attachSessionCollector(client, message, session, interaction.channel);
        }
    },
};
