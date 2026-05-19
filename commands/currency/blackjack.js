const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require("discord.js");
const { addNewDBUser, db } = require("../../database");
const { CURRENCY_NAME, BLACKJACK_MAX_HANDS, PANEL_IDLE_TIMEOUT } = require("../../config.js");
const { parseBet } = require("../../utils/betparse");
const { openBetModal, resolveBet } = require("../../utils/betModal");
const wait = require("node:timers/promises").setTimeout;
const { getHandValue, statusFromValue, checkHand, canSplit, isAcePair } = require("../../utils/blackjack");
const { newDeck, drawCard } = require("../../utils/cards");
const { canvasBlackjack } = require("../../utils/blackjackCanvas");
const { getEquippedTheme } = require("../../themes/manager");
const { getBlackjackColors } = require("../../themes/resolver");
const { withUserLock } = require("../../utils/userlock");
const logger = require("../../utils/logger");
const { randomHexColor } = require("../../utils/randomcolor");

const PACKAGE_VERSION = require("../../package.json").version;
const MAX_HANDS = BLACKJACK_MAX_HANDS || 4;

// ─── helpers ─────────────────────────────────────────────────────────────────

function errorEmbed(user, client, description) {
    return new EmbedBuilder()
        .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
        .setColor(0xFF0000)
        .setDescription(description)
        .setFooter({ text: `${client.user.username} | Version ${PACKAGE_VERSION}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();
}

function footerText(client) {
    return `${client.user.username} | Version ${PACKAGE_VERSION}`;
}

// Hub panel buttons shown when no hand is in progress
function buildHubComponents(hasLastBet) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("bj_deal")
            .setLabel(hasLastBet ? "Deal Again" : "Deal")
            .setEmoji("🃏")
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId("bj_change_bet")
            .setLabel("Change Bet")
            .setEmoji("💰")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("bj_leave")
            .setLabel("Leave Table")
            .setEmoji("🚪")
            .setStyle(ButtonStyle.Danger),
    );
    return [row];
}

// All buttons disabled — used during hand animation / while hand is playing
function buildDisabledHubComponents() {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("bj_deal").setLabel("Deal").setEmoji("🃏").setStyle(ButtonStyle.Success).setDisabled(true),
        new ButtonBuilder().setCustomId("bj_change_bet").setLabel("Change Bet").setEmoji("💰").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId("bj_leave").setLabel("Leave Table").setEmoji("🚪").setStyle(ButtonStyle.Danger).setDisabled(true),
    );
    return [row];
}

function buildHubEmbed(user, client, balance, lastHandDesc) {
    const embed = new EmbedBuilder()
        .setAuthor({ name: `${user.displayName}'s table`, iconURL: user.displayAvatarURL({ dynamic: true }) })
        .setColor(0x1a6b3c)
        .setFooter({ text: footerText(client), iconURL: client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();
    const balLine = `Balance: **${balance.toLocaleString("en-US")}** ${CURRENCY_NAME}`;
    embed.setDescription(lastHandDesc ? `${lastHandDesc}\n\n${balLine}` : balLine);
    return embed;
}

// ─── session map helpers ──────────────────────────────────────────────────────

function sessionKey(channelId, userId) {
    return `${channelId}:${userId}`;
}

function getSession(client, channelId, userId) {
    return client.blackjackTables.get(sessionKey(channelId, userId));
}

function deleteSession(client, channelId, userId) {
    client.blackjackTables.delete(sessionKey(channelId, userId));
}

// ─── session lifecycle ────────────────────────────────────────────────────────

async function openHubPanel(interaction, user, client) {
    const key = sessionKey(interaction.channelId, user.id);
    const existing = client.blackjackTables.get(key);
    if (existing && existing.status !== "ended") {
        return interaction.reply({
            embeds: [errorEmbed(user, client, "You already have a blackjack table open in this channel. Use the buttons on your existing table.")],
            ephemeral: true,
        });
    }

    let dbUser = await db.get(user.id);
    if (!dbUser) {
        await addNewDBUser(user);
        dbUser = await db.get(user.id);
    }

    const balance = dbUser.balance ?? 0;
    const themeId = await getEquippedTheme(user.id);
    const colors = getBlackjackColors(themeId);
    const idleAttachment = await canvasBlackjack([], [{ cards: [], bet: 0 }], colors, themeId, false, 0, {
        user,
        dealerUser: client.user,
        idle: true,
    });

    const cachedExpression = (await db.get(`${user.id}.blackjack.lastBet`)) || null;

    const embed = buildHubEmbed(user, client, balance, null);
    embed.setTitle(cachedExpression ? "Blackjack — click Deal Again to continue" : "Blackjack — click Deal to start");
    if (idleAttachment) embed.setImage("attachment://blackjack.png");

    await interaction.deferReply();
    const message = await interaction.editReply({
        embeds: [embed],
        components: buildHubComponents(!!cachedExpression),
        files: idleAttachment ? [idleAttachment] : [],
    });

    const session = createSession(user.id, interaction.channelId, key, message.id, null, "waiting", balance);
    session.lastBetExpression = cachedExpression;
    client.blackjackTables.set(key, session);
    attachSessionCollector(client, message, session, interaction.channel);
}

function createSession(userId, channelId, key, messageId, lastBet, status, startBalance) {
    return {
        userId,
        channelId,
        key,
        messageId,
        lastBet,
        lastBetExpression: null,
        status,
        collector: null,
        startBalance,
        rounds: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        totalWagered: 0,
        totalReturned: 0,
        biggestWin: 0,
        biggestLoss: 0,
    };
}

function attachSessionCollector(client, message, session, channel) {
    if (session.collector) {
        try { session.collector.stop("replaced"); } catch (_) {}
    }

    const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => i.user.id === session.userId && ["bj_deal", "bj_change_bet", "bj_leave"].includes(i.customId),
        idle: PANEL_IDLE_TIMEOUT,
    });
    session.collector = collector;

    collector.on("collect", async (i) => {
        try {
            if (session.status !== "waiting") {
                return i.deferUpdate().catch(() => {});
            }
            if (i.customId === "bj_deal") {
                return handleDeal(i, session, client, channel);
            }
            if (i.customId === "bj_change_bet") {
                return handleChangeBet(i, session, client);
            }
            if (i.customId === "bj_leave") {
                return endSession(client, message, session, "ended", i);
            }
        } catch (err) {
            logger.error(`[blackjack] collector error: ${err && err.stack || err}`);
            try {
                if (!i.replied && !i.deferred) await i.reply({ content: "Something went wrong.", ephemeral: true });
            } catch (_) {}
        }
    });

    collector.on("end", async (_collected, reason) => {
        if (!client.blackjackTables.has(session.key)) return;
        if (reason === "idle" || reason === "time") {
            const current = client.blackjackTables.get(session.key);
            if (current && current.status === "playing") return;
            await endSession(client, message, session, "idle", null);
        }
    });
}

async function endSession(client, message, session, reason, interaction) {
    if (!client.blackjackTables.has(session.key)) return;
    if (session.status === "ended") return;
    session.status = "ended";
    client.blackjackTables.delete(session.key);
    if (session.collector) {
        try { session.collector.stop(reason); } catch (_) {}
    }

    const user = interaction?.user ?? { displayName: "Player", displayAvatarURL: () => null, id: session.userId };
    const embed = await buildSessionSummaryEmbed(user, client, session, reason);

    try {
        if (interaction && !interaction.replied && !interaction.deferred) {
            await interaction.update({ embeds: [embed], components: [], files: [], attachments: [] });
        } else if (interaction && interaction.deferred) {
            await interaction.editReply({ embeds: [embed], components: [], files: [], attachments: [] });
        } else {
            await message.edit({ embeds: [embed], components: [], files: [], attachments: [] });
        }
    } catch (_) {}
}

async function buildSessionSummaryEmbed(user, client, session, reason) {
    const newBalance = await db.get(`${session.userId}.balance`) ?? 0;
    const netProfit = session.totalReturned - session.totalWagered;
    const handsPlayed = session.wins + session.losses + session.pushes;
    const decided = session.wins + session.losses;
    const winPct = decided > 0 ? (session.wins / decided) * 100 : 0;
    const startBal = session.startBalance ?? newBalance;

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
        .setAuthor({ name: `${user.displayName}'s Blackjack summary`, iconURL: user.displayAvatarURL?.({ dynamic: true }) || undefined })
        .setColor(color)
        .setDescription(headline)
        .addFields(
            { name: "Rounds", value: `**${session.rounds.toLocaleString("en-US")}**`, inline: true },
            { name: "Hands", value: `**${handsPlayed.toLocaleString("en-US")}** (${session.wins}W / ${session.losses}L / ${session.pushes}P)`, inline: true },
            { name: "Win Rate", value: decided > 0 ? `**${winPct.toFixed(1)}%**` : "—", inline: true },
            { name: "Wagered", value: `**${session.totalWagered.toLocaleString("en-US")}** ${CURRENCY_NAME}`, inline: true },
            { name: "Returned", value: `**${session.totalReturned.toLocaleString("en-US")}** ${CURRENCY_NAME}`, inline: true },
            { name: "Net Profit", value: profitLine, inline: true },
            { name: " ", value: " ", inline: false},
            { name: "Current Balance", value: `**${newBalance.toLocaleString("en-US")}** ${CURRENCY_NAME}`, inline: false },
        )
        .setFooter({ text: footerText(client), iconURL: client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();

    return embed;
}

// ─── bet modal flows ──────────────────────────────────────────────────────────

async function handleChangeBet(buttonInt, session, client) {
    const user = buttonInt.user;
    const result = await openBetModal(buttonInt, {
        title: "Change your bet",
        placeholder: "e.g. 100, half, max",
    });
    if (!result) return;
    const { amount, expression, submit } = result;

    const current = client.blackjackTables.get(session.key);
    if (!current || current.status === "ended") {
        return submit.reply({ embeds: [errorEmbed(user, client, "Your table is no longer active.")], ephemeral: true });
    }
    current.lastBet = amount;
    current.lastBetExpression = expression;
    await db.set(`${user.id}.blackjack.lastBet`, expression).catch(() => {});

    return submit.reply({
        embeds: [new EmbedBuilder()
            .setColor(0x1a6b3c)
            .setDescription(`Default bet updated to **${amount.toLocaleString("en-US")}** ${CURRENCY_NAME}. Click **Deal Again** to use it.`)
            .setTimestamp()],
        ephemeral: true,
    });
}

async function handleDeal(buttonInt, session, client, channel) {
    const user = buttonInt.user;

    // If a bet expression is cached on the session, re-resolve against the
    // user's current balance so dynamic expressions like `max * 0.2` always
    // reflect the live balance.
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
        title: "Place your bet",
        placeholder: "e.g. 100, half, max",
    });
    if (!result) return;
    const { amount, expression, submit } = result;
    session.lastBetExpression = expression;
    await db.set(`${user.id}.blackjack.lastBet`, expression).catch(() => {});
    return dealWithAmount(submit, session, client, channel, user, amount, /* deferUpdate */ true);
}

async function dealWithAmount(interaction, session, client, channel, user, amount, deferUpdate) {
    const current = client.blackjackTables.get(session.key);
    if (!current || current.status !== "waiting") {
        return interaction.reply({ embeds: [errorEmbed(user, client, "Your table is no longer available.")], ephemeral: true });
    }

    if (amount % 1 !== 0) {
        return interaction.reply({ embeds: [errorEmbed(user, client, "You must bet in whole numbers!")], ephemeral: true });
    }

    const debited = await withUserLock(user.id, async () => {
        const bal = await db.get(`${user.id}.balance`) ?? 0;
        if (bal < amount) return false;
        await db.sub(`${user.id}.balance`, amount);
        return true;
    });
    if (!debited) {
        return interaction.reply({ embeds: [errorEmbed(user, client, `You don't have enough ${CURRENCY_NAME}!`)], ephemeral: true });
    }

    current.lastBet = amount;
    current.status = "playing";
    // lastBetExpression is set by handleDeal (modal path); cached path keeps the
    // existing expression so the next deal re-resolves the same formula.

    if (deferUpdate) await interaction.deferUpdate();

    try {
        const msg = await channel.messages.fetch(current.messageId);
        await runHand(interaction, user, client, current, amount, msg, channel);
    } catch (err) {
        logger.error(`[blackjack] runHand error: ${err && err.stack || err}`);
        current.status = "waiting";
    }
}

// ─── core hand logic ──────────────────────────────────────────────────────────

async function runHand(interaction, user, client, session, originalBet, message, channel) {
    const stats = `${user.id}.stats.blackjack`;
    const themeId = await getEquippedTheme(user.id);
    const colors = getBlackjackColors(themeId);

    session.rounds += 1;
    session.totalWagered += originalBet;

    // Disable hub buttons while hand plays
    await message.edit({ components: buildDisabledHubComponents() }).catch(() => {});

    // Deal initial cards
    const deckId = await newDeck();
    let hands = [];
    let dealerCards = [];
    let currentHandIndex = 0;
    let totalBets = originalBet;

    for (let i = 0; i < 2; i++) {
        dealerCards.push(await drawCard(deckId));
    }
    const initialCards = [await drawCard(deckId), await drawCard(deckId)];
    hands.push({ cards: initialCards, bet: originalBet, isSplitAces: false, isDoubled: false });

    const embed = new EmbedBuilder()
        .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
        .setFooter({ text: `${client.user.username} | Version ${PACKAGE_VERSION}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();

    const statusTag = (status) => status === "bust" ? " 💥" : status === "blackjack" ? " 🃏" : "";

    async function renderState(revealHole = false, activeIndex = 0, title = "Good luck!", description = "", outcomes = [], dealerOutcome = null, playerOutcome = null) {
        const attachment = await canvasBlackjack(dealerCards, hands, colors, themeId, revealHole, activeIndex, { user, dealerUser: client.user, outcomes, dealerOutcome, playerOutcome });
        if (attachment) embed.setImage("attachment://blackjack.png");
        embed.setTitle(title);
        if (description) embed.setDescription(description);
        return attachment;
    }

    // ── natural blackjack check ──
    if (checkHand(initialCards) === "blackjack") {
        const dealerTotal = getHandValue(dealerCards);
        const naturalOutcome = dealerTotal === 21 ? "push" : "win";
        const dealerOutcome = dealerTotal === 21 ? "push" : "loss";
        const attachment = await renderState(true, 0, "Blackjack!", "", [naturalOutcome], dealerOutcome, naturalOutcome);
        if (dealerTotal === 21) {
            await db.add(`${stats}.ties`, 1);
            await withUserLock(user.id, () => db.add(`${user.id}.balance`, originalBet));
            session.totalReturned += originalBet;
            session.pushes += 1;
            embed.setColor(0xFFFF00).setDescription(`Both have blackjack! It's a push!\nYour balance is **${((await db.get(`${user.id}.balance`))).toLocaleString("en-US")}** ${CURRENCY_NAME}.`);
        } else {
            const winnings = originalBet + Math.ceil(originalBet * 1.5);
            await withUserLock(user.id, () => db.add(`${user.id}.balance`, winnings));
            await db.add(`${stats}.wins`, 1);
            await db.add(`${stats}.blackjacks`, 1);
            const biggestWin = await db.get(`${stats}.biggestWin`) || 0;
            if (winnings > biggestWin) await db.set(`${stats}.biggestWin`, winnings);
            await db.add(`${stats}.profit`, winnings - originalBet);
            session.totalReturned += winnings;
            session.wins += 1;
            const sessionProfit = winnings - originalBet;
            if (sessionProfit > session.biggestWin) session.biggestWin = sessionProfit;
            embed.setColor(0x00AE86)
                .setDescription(`You got blackjack! You win **${(originalBet * 1.5).toLocaleString("en-US")}** ${CURRENCY_NAME}!\nYour new balance is **${((await db.get(`${user.id}.balance`))).toLocaleString("en-US")}** ${CURRENCY_NAME}.`)
                .setFooter({ text: `Bet: ${originalBet.toLocaleString("en-US")} ${CURRENCY_NAME} | ${client.user.username} | Version ${PACKAGE_VERSION}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) });
        }
        await message.edit({ embeds: [embed], components: [], files: attachment ? [attachment] : [] });
        return finishHand(client, message, session, channel, embed.data.description, attachment);
    }

    // ── dealer natural blackjack ──
    if (checkHand(dealerCards) === "blackjack") {
        await db.add(`${stats}.losses`, 1);
        await db.add(`${stats}.profit`, -originalBet);
        const biggestLoss = await db.get(`${stats}.biggestLoss`) || 0;
        if (originalBet > biggestLoss) await db.set(`${stats}.biggestLoss`, originalBet);
        session.losses += 1;
        if (originalBet > session.biggestLoss) session.biggestLoss = originalBet;
        const attachment = await renderState(true, 0, "Dealer Blackjack!", "", ["loss"], "win", "loss");
        embed.setColor(0xFF0000)
            .setDescription(`Dealer has blackjack! You lose **${originalBet.toLocaleString("en-US")}** ${CURRENCY_NAME}.\nYour balance is **${((await db.get(`${user.id}.balance`))).toLocaleString("en-US")}** ${CURRENCY_NAME}.`)
            .setFooter({ text: `Bet: ${originalBet.toLocaleString("en-US")} ${CURRENCY_NAME} | ${client.user.username} | Version ${PACKAGE_VERSION}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) });
        await message.edit({ embeds: [embed], components: [], files: attachment ? [attachment] : [] });
        return finishHand(client, message, session, channel, embed.data.description, attachment);
    }

    const FORFEIT_WINDOW_MS = 10000;
    let handCount = 0;

    async function playHands() {
        while (currentHandIndex < hands.length) {
            const currentHand = hands[currentHandIndex];
            const balance = await db.get(`${user.id}.balance`);
            const hasTwo = currentHand.cards.length === 2;
            const canAffordBet = balance >= currentHand.bet;
            const canSplitThisHand = hasTwo && canSplit(currentHand.cards) && hands.length < MAX_HANDS && !currentHand.isSplitAces && canAffordBet;
            const canDouble = hasTwo && !currentHand.isDoubled && canAffordBet;
            const canForfeit = hands.length === 1 && hasTwo && !currentHand.isDoubled;
            const result = await playHand(currentHand, currentHandIndex, canSplitThisHand, canDouble, canForfeit);
            if (result === "forfeit") {
                const forfeitAttachment = currentHand._forfeitAttachment || null;
                await finishHand(client, message, session, channel, "You forfeited the hand.", forfeitAttachment);
                return;
            }
            currentHandIndex++;
        }
        await playDealer();
    }

    async function playHand(hand, handIndex, splitEnabled, canDouble, canForfeit = false) {
        handCount++;
        const hid = handCount; // hand ID for button namespacing

        return new Promise(async (resolve) => {
            embed.setColor(randomHexColor());
            embed.setFooter({ text: `Bet: ${hand.bet.toLocaleString("en-US")} ${CURRENCY_NAME} | ${client.user.username} | Version ${PACKAGE_VERSION}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) });

            const title = hands.length > 1 ? `Hand ${handIndex + 1} of ${hands.length}` : "Good luck!";
            const attachment = await renderState(false, handIndex, title);

            if (hand.isSplitAces) {
                await message.edit({ embeds: [embed], components: [], files: attachment ? [attachment] : [] });
                await wait(1000);
                resolve(statusFromValue(getHandValue(hand.cards)) === "bust" ? "bust" : "stand");
                return;
            }

            const buttonRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`bj_h${hid}_hit`).setLabel("Hit").setStyle(ButtonStyle.Primary).setEmoji("☝"),
                new ButtonBuilder().setCustomId(`bj_h${hid}_stand`).setLabel("Stand").setStyle(ButtonStyle.Primary).setEmoji("✋"),
                new ButtonBuilder().setCustomId(`bj_h${hid}_double`).setLabel("Double Down").setStyle(ButtonStyle.Success).setEmoji("💵").setDisabled(!canDouble),
            );

            const splitButton = new ButtonBuilder()
                .setCustomId(`bj_h${hid}_split`)
                .setLabel("Split")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("✂")
                .setDisabled(!splitEnabled);

            if (splitEnabled || hands.length > 1) buttonRow.addComponents(splitButton);

            const forfeitButton = new ButtonBuilder()
                .setCustomId(`bj_h${hid}_forfeit`)
                .setLabel("Forfeit")
                .setStyle(ButtonStyle.Danger)
                .setEmoji("🏳")
                .setDisabled(!canForfeit);

            if (canForfeit) buttonRow.addComponents(forfeitButton);

            await message.edit({ embeds: [embed], components: [buttonRow], files: attachment ? [attachment] : [] });

            const disableAdvancedActions = () => {
                for (const btn of buttonRow.components) {
                    const id = btn.data?.custom_id;
                    if (id !== `bj_h${hid}_hit` && id !== `bj_h${hid}_stand`) btn.setDisabled(true);
                }
            };

            let forfeitTimer = null;
            if (canForfeit) {
                forfeitTimer = setTimeout(async () => {
                    const fb = buttonRow.components.find(b => b.data?.custom_id === `bj_h${hid}_forfeit`);
                    if (fb && !fb.data.disabled) {
                        fb.setDisabled(true);
                        try { await message.edit({ embeds: [embed], components: [buttonRow] }); } catch (_) {}
                    }
                }, FORFEIT_WINDOW_MS);
            }

            const filter = i => i.user.id === user.id && i.customId.startsWith(`bj_h${hid}_`);
            const collector = message.createMessageComponentCollector({ filter, time: 60000 });

            // Keep outer session collector alive while hand buttons are clicked
            collector.on("collect", async i => {
                if (session.collector) {
                    try { session.collector.resetTimer(); } catch (_) {}
                }
                if (forfeitTimer) { clearTimeout(forfeitTimer); forfeitTimer = null; }

                const action = i.customId.replace(`bj_h${hid}_`, "");

                if (action === "hit") {
                    hand.cards.push(await drawCard(deckId));
                    const newVal = getHandValue(hand.cards);
                    const handStatus = statusFromValue(newVal);

                    if (handStatus === "bust") {
                        const title = hands.length > 1 ? `Hand ${handIndex + 1} — Bust! (${newVal})` : `Bust! (${newVal})`;
                        const att = await renderState(false, handIndex, title);
                        embed.setColor(0xFF0000);
                        await i.update({ embeds: [embed], components: [], files: att ? [att] : [] });
                        collector.stop("bust");
                    } else if (handStatus === "blackjack") {
                        const title = hands.length > 1 ? `Hand ${handIndex + 1} — 21!` : "21!";
                        const att = await renderState(false, handIndex, title);
                        embed.setColor(0x00AE86);
                        await i.update({ embeds: [embed], components: [], files: att ? [att] : [] });
                        collector.stop("blackjack");
                    } else {
                        disableAdvancedActions();
                        const att = await renderState(false, handIndex, title);
                        await i.update({ embeds: [embed], components: [buttonRow], files: att ? [att] : [] });
                    }
                } else if (action === "stand") {
                    const standVal = getHandValue(hand.cards);
                    const stTitle = hands.length > 1 ? `Hand ${handIndex + 1} — Stand (${standVal})` : `Stand (${standVal})`;
                    const att = await renderState(false, handIndex, stTitle);
                    await i.update({ embeds: [embed], components: [], files: att ? [att] : [] });
                    collector.stop("stand");
                } else if (action === "double") {
                    await withUserLock(user.id, () => db.sub(`${user.id}.balance`, hand.bet));
                    totalBets += hand.bet;
                    session.totalWagered += hand.bet;
                    hand.bet *= 2;
                    hand.isDoubled = true;
                    hand.cards.push(await drawCard(deckId));
                    const newVal = getHandValue(hand.cards);
                    const doubleStatus = statusFromValue(newVal);
                    const dTitle = doubleStatus === "bust"
                        ? (hands.length > 1 ? `Hand ${handIndex + 1} — Double Down — Bust! (${newVal})` : `Double Down — Bust! (${newVal})`)
                        : (hands.length > 1 ? `Hand ${handIndex + 1} — Double Down (${newVal})` : `Double Down (${newVal})`);
                    const att = await renderState(false, handIndex, dTitle);
                    if (doubleStatus === "bust") embed.setColor(0xFF0000);
                    embed.setFooter({ text: `Bet: ${hand.bet.toLocaleString("en-US")} ${CURRENCY_NAME} | ${client.user.username} | Version ${PACKAGE_VERSION}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) });
                    await i.update({ embeds: [embed], components: [], files: att ? [att] : [] });
                    collector.stop(doubleStatus === "bust" ? "bust" : doubleStatus === "blackjack" ? "blackjack" : "stand");
                } else if (action === "split") {
                    await withUserLock(user.id, () => db.sub(`${user.id}.balance`, hand.bet));
                    totalBets += hand.bet;
                    session.totalWagered += hand.bet;
                    const wasAcePair = isAcePair(hand.cards);
                    const splitCard = hand.cards[1];
                    hand.cards = [hand.cards[0], await drawCard(deckId)];
                    const newHand = { cards: [splitCard, await drawCard(deckId)], bet: hand.bet, isSplitAces: wasAcePair, isDoubled: false };
                    hand.isSplitAces = wasAcePair;
                    hands.splice(handIndex + 1, 0, newHand);
                    const att = await renderState(false, handIndex, `Split! (${hands.length} hands)`);
                    await i.update({ embeds: [embed], components: [], files: att ? [att] : [] });
                    collector.stop("split");
                } else if (action === "forfeit") {
                    const refund = Math.floor(hand.bet / 2);
                    const netLoss = hand.bet - refund;
                    await withUserLock(user.id, () => db.add(`${user.id}.balance`, refund));
                    await db.add(`${stats}.losses`, 1);
                    await db.add(`${stats}.surrenders`, 1);
                    await db.add(`${stats}.profit`, -netLoss);
                    const biggestLoss = await db.get(`${stats}.biggestLoss`) || 0;
                    if (netLoss > biggestLoss) await db.set(`${stats}.biggestLoss`, netLoss);
                    session.totalReturned += refund;
                    session.losses += 1;
                    if (netLoss > session.biggestLoss) session.biggestLoss = netLoss;
                    const att = await renderState(true, handIndex, "Forfeit",
                        `You forfeited and recovered **${refund.toLocaleString("en-US")}** ${CURRENCY_NAME}.\nYour balance is **${((await db.get(`${user.id}.balance`))).toLocaleString("en-US")}** ${CURRENCY_NAME}.`);
                    embed.setColor(0xAAAAAA);
                    embed.setFooter({ text: `Bet: ${hand.bet.toLocaleString("en-US")} ${CURRENCY_NAME} (forfeited) | ${client.user.username} | Version ${PACKAGE_VERSION}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) });
                    await i.update({ embeds: [embed], components: [], files: att ? [att] : [] });
                    logger.info(`${user.username}(${user.id}) forfeited, recovering ${refund} ${CURRENCY_NAME}.`);
                    hand._forfeitAttachment = att;
                    collector.stop("forfeit");
                }
            });

            collector.on("end", async (_collected, reason) => {
                if (forfeitTimer) { clearTimeout(forfeitTimer); forfeitTimer = null; }

                if (hands.length > 1 && ["bust", "blackjack", "stand"].includes(reason)) {
                    await wait(1500);
                }

                if (["bust", "blackjack", "stand", "forfeit"].includes(reason)) {
                    resolve(reason);
                } else if (reason === "split") {
                    const balance = await db.get(`${user.id}.balance`);
                    const hasTwo = hand.cards.length === 2;
                    const canAffordBet = balance >= hand.bet;
                    const canSplitThisHand = hasTwo && canSplit(hand.cards) && hands.length < MAX_HANDS && !hand.isSplitAces && canAffordBet;
                    const canDoubleHand = hasTwo && !hand.isDoubled && canAffordBet;
                    resolve(await playHand(hand, handIndex, canSplitThisHand, canDoubleHand));
                } else {
                    resolve("stand");
                }
            });
        });
    }

    async function playDealer() {
        embed.setColor(randomHexColor());
        embed.setFooter({ text: `${client.user.username} | Version ${PACKAGE_VERSION}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) });

        let attachment = await renderState(true, 0, "Dealer's turn");
        await message.edit({ embeds: [embed], components: [], files: attachment ? [attachment] : [] });
        await wait(1000);

        let dealerTotal = getHandValue(dealerCards);
        while (dealerTotal < 17) {
            dealerCards.push(await drawCard(deckId));
            dealerTotal = getHandValue(dealerCards);
            attachment = await renderState(true, 0, "Dealer's turn");
            await message.edit({ embeds: [embed], components: [], files: attachment ? [attachment] : [] });
            await wait(1000);
        }

        const dealerStatus = statusFromValue(dealerTotal);
        let totalWinnings = 0;
        let biggestHandLoss = 0;
        let resultLines = [];
        const outcomes = [];

        for (let i = 0; i < hands.length; i++) {
            const hand = hands[i];
            const handTotal = getHandValue(hand.cards);
            const handStatus = statusFromValue(handTotal);
            let handResult = "";
            let winnings = 0;

            if (handStatus === "bust") {
                handResult = "BUST";
                if (hand.bet > biggestHandLoss) biggestHandLoss = hand.bet;
                await db.add(`${stats}.losses`, 1);
                session.losses += 1;
            } else if (dealerStatus === "bust") {
                winnings = hand.bet * 2;
                handResult = "WIN";
                totalWinnings += winnings;
                await db.add(`${stats}.wins`, 1);
                session.wins += 1;
            } else if (handTotal > dealerTotal) {
                winnings = hand.bet * 2;
                handResult = "WIN";
                totalWinnings += winnings;
                await db.add(`${stats}.wins`, 1);
                session.wins += 1;
            } else if (handTotal < dealerTotal) {
                handResult = "LOSE";
                if (hand.bet > biggestHandLoss) biggestHandLoss = hand.bet;
                await db.add(`${stats}.losses`, 1);
                session.losses += 1;
            } else {
                winnings = hand.bet;
                handResult = "PUSH";
                totalWinnings += winnings;
                await db.add(`${stats}.ties`, 1);
                session.pushes += 1;
            }

            outcomes.push(handResult === "WIN" ? "win" : handResult === "PUSH" ? "push" : "loss");

            const marker = hand.isDoubled ? " 💵" : "";
            const tag = statusTag(handStatus);
            const label = hands.length > 1 ? `Hand ${i + 1}:` : "Your hand:";
            resultLines.push(`**${label}** (${handTotal})${marker}${tag} → ${handResult}${winnings > 0 ? ` (+${winnings.toLocaleString("en-US")})` : ""}`);
        }

        if (totalWinnings > 0) {
            await withUserLock(user.id, () => db.add(`${user.id}.balance`, totalWinnings));
            const profit = totalWinnings - totalBets;
            if (profit > 0) {
                const biggestWin = await db.get(`${stats}.biggestWin`) || 0;
                if (profit > biggestWin) await db.set(`${stats}.biggestWin`, profit);
            }
        }
        if (biggestHandLoss > 0) {
            const biggestLoss = await db.get(`${stats}.biggestLoss`) || 0;
            if (biggestHandLoss > biggestLoss) await db.set(`${stats}.biggestLoss`, biggestHandLoss);
        }

        const netProfit = totalWinnings - totalBets;
        await db.add(`${stats}.profit`, netProfit);
        session.totalReturned += totalWinnings;
        if (netProfit > session.biggestWin) session.biggestWin = netProfit;
        if (biggestHandLoss > session.biggestLoss) session.biggestLoss = biggestHandLoss;

        const dTitle = dealerStatus === "bust" ? "Dealer busts!" : `Dealer: ${dealerTotal}`;
        const newBal = await db.get(`${user.id}.balance`);
        const desc = `${resultLines.join("\n")}\n\n${totalWinnings > totalBets ? `You won **${(totalWinnings - totalBets).toLocaleString("en-US")}** ${CURRENCY_NAME}!` : totalWinnings === totalBets ? "You broke even." : `You lost **${(totalBets - totalWinnings).toLocaleString("en-US")}** ${CURRENCY_NAME}.`}\nYour balance is **${newBal.toLocaleString("en-US")}** ${CURRENCY_NAME}.`;

        const allWin = outcomes.length > 0 && outcomes.every(o => o === "win");
        const allLoss = outcomes.length > 0 && outcomes.every(o => o === "loss");
        const allPush = outcomes.length > 0 && outcomes.every(o => o === "push");
        const dealerOutcome = allLoss ? "win" : allWin ? "loss" : allPush ? "push" : null;
        const playerOutcome = allWin ? "win" : allLoss ? "loss" : allPush ? "push" : null;
        attachment = await renderState(true, 0, dTitle, desc, outcomes, dealerOutcome, playerOutcome);
        embed.setColor(totalWinnings > totalBets ? 0x00AE86 : (totalWinnings > 0 ? 0xFFFF00 : 0xFF0000));
        await message.edit({ embeds: [embed], components: [], files: attachment ? [attachment] : [] });

        await finishHand(client, message, session, channel, desc, attachment);
    }

    await playHands();
}

// Called after any hand completes (dealer phase done, natural BJ, forfeit, dealer BJ)
async function finishHand(client, message, session, channel, lastHandDesc, lastAttachment = null) {
    const current = client.blackjackTables.get(session.key);
    if (!current || current.status === "ended") return;
    current.status = "waiting";

    const user = await channel.guild.members.fetch(session.userId).then(m => m.user).catch(() => null);
    const balance = user ? (await db.get(`${session.userId}.balance`) ?? 0) : 0;

    const embed = buildHubEmbed(user || { displayName: "Player", displayAvatarURL: () => null }, channel.client, balance, lastHandDesc);
    embed.setTitle("Blackjack — click Deal Again to continue");
    if (lastAttachment) embed.setImage("attachment://blackjack.png");

    try {
        await message.edit({
            embeds: [embed],
            components: buildHubComponents(true),
            files: lastAttachment ? [lastAttachment] : [],
        });
    } catch (err) {
        logger.error(`[blackjack] finishHand edit failed: ${err}`);
    }

    // Restart the session collector so the idle timer resets between hands
    attachSessionCollector(client, message, current, channel);
}

// Slash-with-bet against an already-open hub: validate, debit, ephemerally
// confirm the slash, and run the hand on the existing panel message. Lets
// legacy `/blackjack bet:X` keep working as a one-shot deal without needing
// the user to click the panel button.
async function dealOnExistingTable(interaction, session, client, user, betExpression) {
    const dbUser = (await db.get(user.id)) || {};
    const bet = Number(await parseBet(betExpression, user.id));
    if (isNaN(bet) || bet < 1) {
        return interaction.reply({ embeds: [errorEmbed(user, client, `You must bet at least 1 ${CURRENCY_NAME}!`)], ephemeral: true });
    }
    if (bet % 1 !== 0) {
        return interaction.reply({ embeds: [errorEmbed(user, client, "You must bet in whole numbers!")], ephemeral: true });
    }
    if (bet > (dbUser.balance ?? 0)) {
        return interaction.reply({ embeds: [errorEmbed(user, client, `You don't have enough ${CURRENCY_NAME}!`)], ephemeral: true });
    }

    const debited = await withUserLock(user.id, async () => {
        const bal = (await db.get(`${user.id}.balance`)) ?? 0;
        if (bal < bet) return false;
        await db.sub(`${user.id}.balance`, bet);
        return true;
    });
    if (!debited) {
        return interaction.reply({ embeds: [errorEmbed(user, client, `You don't have enough ${CURRENCY_NAME}!`)], ephemeral: true });
    }

    session.lastBet = bet;
    session.lastBetExpression = String(betExpression).trim();
    session.status = "playing";
    await db.set(`${user.id}.blackjack.lastBet`, session.lastBetExpression).catch(() => {});

    // Clear the previous slash-on-existing-table ephemeral (if any) before
    // posting a fresh one, so the user only ever sees the latest confirmation.
    if (session.lastEphemeralInteraction) {
        session.lastEphemeralInteraction.deleteReply().catch(() => {});
    }
    await interaction.reply({
        content: `Dealing **${bet.toLocaleString("en-US")}** ${CURRENCY_NAME} on your existing table…`,
        ephemeral: true,
    });
    session.lastEphemeralInteraction = interaction;

    try {
        const msg = await interaction.channel.messages.fetch(session.messageId);
        await runHand(interaction, user, client, session, bet, msg, interaction.channel);
    } catch (err) {
        logger.error(`[blackjack] dealOnExistingTable runHand error: ${err && err.stack || err}`);
        session.status = "waiting";
    }
}

// ─── command entry point ──────────────────────────────────────────────────────

module.exports = {
    data: new SlashCommandBuilder()
        .setName("blackjack")
        .setDescription(`Play a game of blackjack for ${CURRENCY_NAME}.`)
        .addStringOption(option =>
            option.setName("bet")
                .setDescription(`Amount of ${CURRENCY_NAME} to bet (omit to open a persistent table panel).`)
                .setRequired(false)),

    async execute(interaction) {
        const user = interaction.user;
        const client = interaction.client;
        const betOption = interaction.options.getString("bet");
        const key = sessionKey(interaction.channelId, user.id);

        // Block a second session from the same user in the same channel.
        // Exception: if the user runs `/blackjack bet:X` while an idle table
        // is open, treat it as a Deal click on that table (legacy slash UX).
        const existing = client.blackjackTables.get(key);
        if (existing && existing.status !== "ended") {
            if (betOption && existing.status === "waiting") {
                return dealOnExistingTable(interaction, existing, client, user, betOption);
            }
            return interaction.reply({
                embeds: [errorEmbed(user, client, existing.status === "playing"
                    ? "A hand is already in progress on your table. Wait for it to finish."
                    : "You already have a blackjack table open in this channel. Use the buttons on your existing message.")],
                ephemeral: true,
            });
        }

        if (!betOption) {
            return openHubPanel(interaction, user, client);
        }

        // ── Fast path: bet provided, deal immediately ──
        let dbUser = await db.get(user.id);
        if (!dbUser) {
            await addNewDBUser(user);
            dbUser = await db.get(user.id);
        }

        const originalBet = Number(await parseBet(betOption, user.id));
        if (isNaN(originalBet) || originalBet < 1) {
            return interaction.reply({ embeds: [errorEmbed(user, client, `You must bet at least 1 ${CURRENCY_NAME}!`)], ephemeral: true });
        }
        if (originalBet % 1 !== 0) {
            return interaction.reply({ embeds: [errorEmbed(user, client, "You must bet in whole numbers!")], ephemeral: true });
        }
        if (originalBet > (dbUser.balance ?? 0)) {
            return interaction.reply({ embeds: [errorEmbed(user, client, `You don't have enough ${CURRENCY_NAME}!`)], ephemeral: true });
        }

        await interaction.deferReply();

        const startBalance = dbUser.balance ?? 0;
        const debited = await withUserLock(user.id, async () => {
            const bal = await db.get(`${user.id}.balance`) ?? 0;
            if (bal < originalBet) return false;
            await db.sub(`${user.id}.balance`, originalBet);
            return true;
        });
        if (!debited) {
            return interaction.editReply({ embeds: [errorEmbed(user, client, `You don't have enough ${CURRENCY_NAME}!`)] });
        }

        logger.info(`${user.username}(${user.id}) started blackjack (fast path) with bet ${originalBet} ${CURRENCY_NAME}.`);

        // Create session before the hand so finishHand can find it
        const message = await interaction.fetchReply();
        const session = createSession(user.id, interaction.channelId, key, message.id, originalBet, "playing", startBalance);
        // Seed expression from the slash-option string so follow-on Deal Again
        // re-resolves dynamic bets like `max` against current balance.
        session.lastBetExpression = String(betOption).trim();
        await db.set(`${user.id}.blackjack.lastBet`, session.lastBetExpression).catch(() => {});
        client.blackjackTables.set(key, session);

        await runHand(interaction, user, client, session, originalBet, message, interaction.channel);
    },
};
