const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require("discord.js");
const { addNewDBUser, db } = require("../../database");
const { CURRENCY_NAME, CRAPS_MIN_BET, CRAPS_MAX_BET, CRAPS_ROUND_TIMEOUT, CRAPS_ANIMATION_HOLD_MS } = require("../../config.js");
const { openBetModal, resolveBet } = require("../../utils/betModal");
const { BET_DEFINITIONS, validateBetAllowed, resolveBets, rollDice } = require("../../utils/craps");
const { drawCrapsTable, drawDiceAnimation, drawPaytable } = require("../../utils/crapsCanvas");
const { getEquippedTheme } = require("../../themes/manager");
const { getThemeColors } = require("../../themes/resolver");
const { contributeToJackpot } = require("../../utils/jackpot");
const { randomHexColor } = require("../../utils/randomcolor");
const { withUserLock } = require("../../utils/userlock");
const { sendDM } = require("../../utils/dm");
const logger = require("../../utils/logger");
const wait = require("node:timers/promises").setTimeout;

const PACKAGE_VERSION = require("../../package.json").version;

module.exports = {
    data: new SlashCommandBuilder()
        .setName("craps")
        .setDescription(`Play a game of craps for ${CURRENCY_NAME}.`)
        .addSubcommand(s => s
            .setName("play")
            .setDescription("Open a craps table in this channel. Place bets via the buttons below the table."))
        .addSubcommand(s => s
            .setName("paytable")
            .setDescription("Show the craps payout table.")),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        if (sub === "paytable") return handlePaytable(interaction);
        return handlePlay(interaction);
    },
};

function errorEmbed(user, client, description) {
    return new EmbedBuilder()
        .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
        .setColor(0xFF0000)
        .setDescription(description)
        .setFooter({ text: `${client.user.username} | Version ${PACKAGE_VERSION}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();
}

async function sendEphemeral(state, interaction, embed) {
    const uid = interaction.user.id;
    state?.lastEphemeralByUser?.[uid]?.deleteReply().catch(() => {});
    await interaction.reply({ embeds: [embed], ephemeral: true });
    if (state) state.lastEphemeralByUser[uid] = interaction;
}

async function handlePaytable(interaction) {
    const themeId = await getEquippedTheme(interaction.user.id);
    const themeColors = getThemeColors(themeId, "craps");
    const attachment = await drawPaytable(themeColors);
    const embed = new EmbedBuilder()
        .setAuthor({ name: interaction.user.displayName, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
        .setColor(themeColors.embedColor || 0x0f4c25)
        .setImage("attachment://craps-paytable.png")
        .setFooter({ text: `${interaction.client.user.username} | Version ${require("../../package.json").version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();
    return interaction.reply({ embeds: [embed], files: [attachment] });
}

async function resolveChipColor(interaction, user) {
    if (user.accentColor) return `#${user.accentColor.toString(16).padStart(6, "0")}`;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (member && member.displayHexColor && member.displayHexColor !== "#000000") return member.displayHexColor;
    return randomHexColor();
}

async function handlePlay(interaction) {
    const client = interaction.client;
    const user = interaction.user;
    const channelId = interaction.channelId;

    const existing = client.crapsGames.get(channelId);
    if (existing) {
        return interaction.reply({ embeds: [errorEmbed(user, client, "A craps session is already running in this channel — click a bet button on the table to join.")], ephemeral: true });
    }

    let dbUser = await db.get(user.id);
    if (!dbUser) {
        await addNewDBUser(user);
    }

    return handleNewGame(interaction, client, user);
}

async function handleNewGame(interaction, client, user) {
    const channel = interaction.channel;
    const channelId = channel.id;

    await interaction.deferReply();

    const themeId = await getEquippedTheme(user.id);
    const themeColors = getThemeColors(themeId, "craps");
    const avatarUrl = user.displayAvatarURL({ extension: "png", size: 256 });
    const chipColor = await resolveChipColor(interaction, user);

    const state = {
        channelId,
        messageId: null,
        creatorId: user.id,
        creatorUsername: user.displayName,
        shooterId: user.id,
        shooterUsername: user.displayName,
        shooterOrder: [user.id],
        phase: "comeout",
        point: null,
        bets: [],
        userAvatars: { [user.id]: avatarUrl },
        userColors: { [user.id]: chipColor },
        themeId,
        themeColors,
        lastRoll: null,
        rollHistory: [],
        shooterStreak: 0,
        totals: { [user.id]: { wagered: 0, won: 0, username: user.displayName } },
        userBetAmounts: {},
        rolling: false,
        status: "active",
        collector: null,
        idleTimer: null,
        lastEphemeralByUser: {},
    };

    logger.log(`${user.username} (${user.id}) opened a craps session in #${channel.name}.`);

    const message = await interaction.editReply(await renderMessage(state, `🎲 New craps session — **${state.shooterUsername}** is the shooter. Place a bet below to begin.`));
    state.messageId = message.id;
    client.crapsGames.set(channelId, state);

    attachCollector(client, channel, message, state);
}

async function handleAddBet(interaction, client, user, betKey, amount, state) {
    const def = BET_DEFINITIONS[betKey];

    const debited = await withUserLock(user.id, async () => {
        const balance = await db.get(`${user.id}.balance`) ?? 0;
        if (balance < amount) return false;
        await db.sub(`${user.id}.balance`, amount);
        return true;
    });
    if (!debited) {
        return sendEphemeral(state, interaction, errorEmbed(user, client, "Insufficient funds in wallet!"));
    }
    await db.add(`${user.id}.stats.craps.totalBet`, amount);
    await contributeToJackpot(amount);

    if (!state.shooterOrder.includes(user.id)) {
        state.shooterOrder.push(user.id);
    }
    if (!state.userAvatars[user.id]) {
        state.userAvatars[user.id] = user.displayAvatarURL({ extension: "png", size: 256 });
    }
    if (!state.userColors[user.id]) {
        state.userColors[user.id] = await resolveChipColor(interaction, user);
    }
    if (!state.totals[user.id]) state.totals[user.id] = { wagered: 0, won: 0, username: user.displayName };
    state.totals[user.id].username = user.displayName;
    state.totals[user.id].wagered += amount;

    state.bets.push({ userId: user.id, username: user.displayName, betKey, amount });

    logger.log(`${user.username} (${user.id}) added ${amount} ${CURRENCY_NAME} on ${def.label} to craps session in ${state.channelId}.`);

    await interaction.deferUpdate().catch(() => {});

    try {
        const gameMessage = await interaction.channel.messages.fetch(state.messageId);
        await gameMessage.edit(await renderMessage(state, `**${user.displayName}** placed **${amount.toLocaleString("en-US")}** on **${def.label}**.`));
        if (state.collector) state.collector.resetTimer();
    } catch (err) {
        logger.error(`[craps] failed to update session message: ${err}`);
    }
}

async function renderMessage(state, description = "") {
    const attachment = await drawCrapsTable(state, state.themeColors);
    const phaseLabel = state.phase === "point" ? `Point: ${state.point}` : "Come-out roll";
    const embed = new EmbedBuilder()
        .setAuthor({ name: `${state.shooterUsername}'s table`, iconURL: state.userAvatars[state.shooterId] })
        .setColor(state.themeColors.embedColor || randomHexColor())
        .setImage("attachment://craps.png")
        .setFooter({ text: `${phaseLabel} · ${state.shooterOrder.length} player${state.shooterOrder.length === 1 ? "" : "s"} · Shooter: ${state.shooterUsername}` })
        .setTimestamp();
    if (description) embed.setDescription(description);
    return { embeds: [embed], files: [attachment], components: buildComponents(state) };
}

function buildComponents(state, opts = {}) {
    const disableAll = !!opts.disableAll || state.status !== "active";
    const phase = state.phase;

    const betRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("craps_bet_pass").setLabel("Pass").setStyle(ButtonStyle.Success).setDisabled(disableAll || phase !== "comeout"),
        new ButtonBuilder().setCustomId("craps_bet_dontPass").setLabel("Don't Pass").setStyle(ButtonStyle.Danger).setDisabled(disableAll || phase !== "comeout"),
        new ButtonBuilder().setCustomId("craps_bet_field").setLabel("Field").setStyle(ButtonStyle.Primary).setDisabled(disableAll),
        new ButtonBuilder().setCustomId("craps_bet_any7").setLabel("Any 7").setStyle(ButtonStyle.Secondary).setDisabled(disableAll),
        new ButtonBuilder().setCustomId("craps_bet_anyCraps").setLabel("Any Craps").setStyle(ButtonStyle.Secondary).setDisabled(disableAll),
    );

    const sessionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("craps_roll")
            .setLabel("Roll")
            .setEmoji("🎲")
            .setStyle(ButtonStyle.Success)
            .setDisabled(disableAll || state.bets.length === 0),
        new ButtonBuilder()
            .setCustomId("craps_passDice")
            .setLabel("Pass Dice")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disableAll || state.shooterOrder.length < 2),
        new ButtonBuilder()
            .setCustomId("craps_changeBet")
            .setLabel("Change Bet")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disableAll),
        new ButtonBuilder()
            .setCustomId("craps_end")
            .setLabel("End Session")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disableAll),
    );
    return [betRow, sessionRow];
}

function attachCollector(client, channel, message, state) {
    const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        idle: CRAPS_ROUND_TIMEOUT,
    });
    state.collector = collector;

    collector.on("collect", async (i) => {
        try {
            if (i.customId.startsWith("craps_bet_")) {
                const betKey = i.customId.replace("craps_bet_", "");
                return handleBetButton(i, state, betKey, client);
            }
            if (i.customId === "craps_roll") {
                if (i.user.id !== state.shooterId) {
                    return sendEphemeral(state, i, errorEmbed(i.user, client, `Only the shooter (**${state.shooterUsername}**) can roll. Place a bet to join the table.`));
                }
                return handleRoll(i, state, client);
            }
            if (i.customId === "craps_passDice") {
                return handlePassDice(i, state, client);
            }
            if (i.customId === "craps_changeBet") {
                return handleChangeBet(i, state);
            }
            if (i.customId === "craps_end") {
                if (i.user.id !== state.creatorId) {
                    return sendEphemeral(state, i, errorEmbed(i.user, client, `Only **${state.creatorUsername}** (who started this session) can end it.`));
                }
                return endSession(client, channel, message, state, "ended", i);
            }
        } catch (err) {
            logger.error(`[craps] handler error: ${err && err.stack || err}`);
            try {
                if (!i.replied && !i.deferred) await i.reply({ embeds: [errorEmbed(i.user, client, "Something went wrong handling that action.")], ephemeral: true });
            } catch (_) { /* ignore */ }
        }
    });

    collector.on("end", async (_collected, reason) => {
        if (!client.crapsGames.has(state.channelId)) return;
        if (reason === "idle" || reason === "time") {
            await endSession(client, channel, message, state, "idle", null);
        }
    });
}

async function handleBetButton(buttonInt, state, betKey, client) {
    const def = BET_DEFINITIONS[betKey];
    if (!def) {
        return sendEphemeral(state, buttonInt, errorEmbed(buttonInt.user, client, "Unknown bet type."));
    }

    const preCheck = validateBetAllowed(betKey, state.phase, state.point, state.bets);
    if (!preCheck.allowed) {
        return sendEphemeral(state, buttonInt, errorEmbed(buttonInt.user, client, preCheck.reason));
    }

    const cachedAmount = state.userBetAmounts[buttonInt.user.id];
    if (cachedAmount) {
        return handleAddBet(buttonInt, client, buttonInt.user, betKey, cachedAmount, state);
    }

    // No in-session cache — try the user's persisted lastBet expression so dynamic
    // bets like `half` re-resolve against the current balance on every new session.
    const persistedExpression = (await db.get(`${buttonInt.user.id}.craps.lastBet`)) || null;
    if (persistedExpression) {
        const resolved = await resolveBet(persistedExpression, buttonInt.user.id, { min: CRAPS_MIN_BET, max: CRAPS_MAX_BET });
        if (resolved.ok) {
            state.userBetAmounts[buttonInt.user.id] = resolved.amount;
            return handleAddBet(buttonInt, client, buttonInt.user, betKey, resolved.amount, state);
        }
    }

    const result = await openBetModal(buttonInt, {
        title: `Place ${def.label} bet`,
        min: CRAPS_MIN_BET,
        max: CRAPS_MAX_BET,
        defaultAmount: persistedExpression || undefined,
    });
    if (!result) return;
    const { amount, expression, submit } = result;

    // Re-resolve the session — the modal sat open for up to 60s, anything could have happened.
    const current = client.crapsGames.get(state.channelId);
    if (!current || current.status === "ended") {
        return sendEphemeral(null, submit, errorEmbed(submit.user, client, "This craps session is no longer active."));
    }
    if (current.status !== "active") {
        return sendEphemeral(current, submit, errorEmbed(submit.user, client, "A roll is in progress — try again in a moment."));
    }
    const postCheck = validateBetAllowed(betKey, current.phase, current.point, current.bets);
    if (!postCheck.allowed) {
        return sendEphemeral(current, submit, errorEmbed(submit.user, client, postCheck.reason));
    }

    current.userBetAmounts[submit.user.id] = amount;
    await db.set(`${submit.user.id}.craps.lastBet`, expression).catch(() => {});
    return handleAddBet(submit, client, submit.user, betKey, amount, current);
}

async function handlePassDice(i, state, client) {
    if (i.user.id !== state.shooterId) {
        return sendEphemeral(state, i, errorEmbed(i.user, client, `Only the shooter (**${state.shooterUsername}**) can pass the dice.`));
    }
    if (state.shooterOrder.length < 2) {
        return sendEphemeral(state, i, errorEmbed(i.user, client, "There are no other players to pass the dice to."));
    }
    const next = pickNextShooter(state);
    state.shooterId = next;
    state.shooterUsername = displayNameFor(state, next);
    state.shooterStreak = 0;

    await i.deferUpdate();

    const desc = `🎯 **${i.user.displayName}** passed the dice to **${state.shooterUsername}**.`;
    try {
        const gameMessage = await i.channel.messages.fetch(state.messageId);
        await gameMessage.edit(await renderMessage(state, desc));
        if (state.collector) state.collector.resetTimer();
    } catch (err) {
        logger.error(`[craps] failed to update session after dice pass: ${err}`);
    }
}

async function handleChangeBet(buttonInt, state) {
    const client = buttonInt.client;
    const persistedExpression = (await db.get(`${buttonInt.user.id}.craps.lastBet`)) || undefined;
    const result = await openBetModal(buttonInt, {
        title: "Set craps bet amount",
        min: CRAPS_MIN_BET,
        max: CRAPS_MAX_BET,
        defaultAmount: persistedExpression,
    });
    if (!result) return;
    const { amount, expression, submit } = result;

    const current = client.crapsGames.get(state.channelId);
    if (!current || current.status === "ended") {
        return sendEphemeral(null, submit, errorEmbed(submit.user, client, "This craps session is no longer active."));
    }
    current.userBetAmounts[submit.user.id] = amount;
    await db.set(`${submit.user.id}.craps.lastBet`, expression).catch(() => {});

    const embed = new EmbedBuilder()
        .setAuthor({ name: submit.user.displayName, iconURL: submit.user.displayAvatarURL({ dynamic: true }) })
        .setColor(current.themeColors.embedColor || randomHexColor())
        .setDescription(`Your bet amount is now **${amount.toLocaleString("en-US")}** ${CURRENCY_NAME}. Click any bet button to place it.`)
        .setFooter({ text: `${client.user.username} | Version ${PACKAGE_VERSION}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();
    return sendEphemeral(current, submit, embed);
}

async function handleRoll(i, state, client) {
    if (state.bets.length === 0) {
        return sendEphemeral(state, i, errorEmbed(i.user, client, "Place at least one bet before rolling."));
    }
    if (state.rolling) {
        return sendEphemeral(state, i, errorEmbed(i.user, client, "A roll is already in progress."));
    }
    state.rolling = true;
    state.status = "rolling";

    // Snapshot bets before any await — a slow render plus a concurrent /craps play
    // could otherwise resolve a bet that was added mid-roll.
    const lockedBets = state.bets;
    state.bets = [];
    await i.deferUpdate();

    const roll = rollDice();
    const gif = await drawDiceAnimation(roll.d1, roll.d2, state.themeColors);
    const tumbleEmbed = new EmbedBuilder()
        .setAuthor({ name: `${state.shooterUsername} is shooting…`, iconURL: state.userAvatars[state.shooterId] })
        .setColor(state.themeColors.embedColor || randomHexColor())
        .setDescription("🎲 Rolling...")
        .setImage("attachment://craps-roll.gif")
        .setTimestamp();
    await i.editReply({ embeds: [tumbleEmbed], files: [gif], components: buildComponents(state, { disableAll: true }) });
    await wait(CRAPS_ANIMATION_HOLD_MS);

    const oldPhase = state.phase;
    const oldPoint = state.point;
    const { results, newPhase, newPoint, sevenOut, pointHit } = resolveBets(lockedBets, roll, oldPhase, oldPoint);

    const perUser = {};
    const lines = [];

    for (let idx = 0; idx < results.length; idx++) {
        const r = results[idx];
        const bet = lockedBets[idx];
        const def = BET_DEFINITIONS[r.betKey];
        if (!perUser[bet.userId]) perUser[bet.userId] = { username: bet.username, balanceChange: 0, won: 0, lost: 0, pushed: 0, winCount: 0, lossCount: 0, pushCount: 0, biggestWin: 0, biggestLoss: 0 };
        const u = perUser[bet.userId];

        if (r.status === "win") {
            const winnings = r.payoutAmount - r.originalAmount;
            u.balanceChange += r.payoutAmount;
            u.won += winnings;
            u.winCount += 1;
            if (winnings > u.biggestWin) u.biggestWin = winnings;
            lines.push(`✅ **${bet.username}** won **${winnings.toLocaleString("en-US")}** on **${def.label}**`);
        } else if (r.status === "lose") {
            u.lost += r.originalAmount;
            u.lossCount += 1;
            if (r.originalAmount > u.biggestLoss) u.biggestLoss = r.originalAmount;
            lines.push(`❌ **${bet.username}** lost **${r.originalAmount.toLocaleString("en-US")}** on **${def.label}**`);
        } else if (r.status === "push") {
            u.balanceChange += r.payoutAmount;
            u.pushed += r.originalAmount;
            u.pushCount += 1;
            lines.push(`➖ **${bet.username}**'s **${def.label}** pushed`);
        }
    }

    // Surviving bets (line bets that traveled through come-out / haven't resolved) stay.
    state.bets = lockedBets.filter((_, idx) => !results[idx].remove);
    state.phase = newPhase;
    state.point = newPoint;
    state.lastRoll = { d1: roll.d1, d2: roll.d2, total: roll.total, isHard: roll.isHard };

    const pointJustSet = oldPhase === "comeout" && newPhase === "point";

    // Roll history feeds the canvas strip. Kind classification mirrors the
    // dice-result language the embed uses.
    let rollKind = "neutral";
    if (sevenOut) rollKind = "sevenOut";
    else if (pointHit) rollKind = "pointHit";
    else if (pointJustSet) rollKind = "pointSet";
    else if (oldPhase === "comeout" && (roll.total === 7 || roll.total === 11)) rollKind = "natural";
    else if (oldPhase === "comeout" && [2, 3, 12].includes(roll.total)) rollKind = "crap";
    state.rollHistory.push({
        d1: roll.d1,
        d2: roll.d2,
        total: roll.total,
        isHard: roll.isHard,
        kind: rollKind,
        point: pointJustSet ? newPoint : (oldPhase === "point" ? oldPoint : null),
    });
    if (state.rollHistory.length > 32) state.rollHistory.shift();

    // Streak = consecutive clean rolls without a seven-out, used by the
    // spotlight to flag a "hot hand" between rolls.
    if (sevenOut) state.shooterStreak = 0;
    else state.shooterStreak = (state.shooterStreak || 0) + 1;

    const dbWrites = [];
    for (const [uid, u] of Object.entries(perUser)) {
        if (u.balanceChange > 0) {
            dbWrites.push(withUserLock(uid, () => db.add(`${uid}.balance`, u.balanceChange)));
        }
        const profitChange = u.won - u.lost;
        if (profitChange !== 0) dbWrites.push(db.add(`${uid}.stats.craps.profit`, profitChange));
        if (u.winCount) dbWrites.push(db.add(`${uid}.stats.craps.wins`, u.winCount));
        if (u.lossCount) dbWrites.push(db.add(`${uid}.stats.craps.losses`, u.lossCount));
        if (u.pushCount) dbWrites.push(db.add(`${uid}.stats.craps.pushes`, u.pushCount));
        if (u.biggestWin > 0) {
            dbWrites.push((async () => {
                const prev = (await db.get(`${uid}.stats.craps.biggestWin`)) || 0;
                if (u.biggestWin > prev) await db.set(`${uid}.stats.craps.biggestWin`, u.biggestWin);
            })());
        }
        if (u.biggestLoss > 0) {
            dbWrites.push((async () => {
                const prev = (await db.get(`${uid}.stats.craps.biggestLoss`)) || 0;
                if (u.biggestLoss > prev) await db.set(`${uid}.stats.craps.biggestLoss`, u.biggestLoss);
            })());
        }
        if (state.totals[uid]) state.totals[uid].won += u.won - u.lost;
    }
    dbWrites.push(db.add(`${state.shooterId}.stats.craps.rolls`, 1));
    if (pointHit) dbWrites.push(db.add(`${state.shooterId}.stats.craps.pointsHit`, 1));
    if (sevenOut) dbWrites.push(db.add(`${state.shooterId}.stats.craps.sevenOuts`, 1));
    await Promise.all(dbWrites);

    let header = `🎲 **${state.shooterUsername}** rolled **${roll.d1}** + **${roll.d2}** = **${roll.total}**`;
    if (roll.isHard) header += " (hard)";
    if (pointJustSet) header += ` — point is **${newPoint}**!`;
    else if (pointHit) header += " — **point hit!**";
    else if (sevenOut) header += " — **seven out!**";

    let rotationLine = "";
    if (sevenOut) {
        const next = pickNextShooter(state);
        if (next && next !== state.shooterId) {
            state.shooterId = next;
            state.shooterUsername = displayNameFor(state, next);
            rotationLine = `\n🎯 Dice pass to **${state.shooterUsername}**.`;
        }
    }

    state.rolling = false;
    state.status = "active";

    const desc = [header + rotationLine, "", ...(lines.length ? lines : ["No bets resolved this roll."])].join("\n");

    try {
        await i.editReply(await renderMessage(state, desc));
    } catch (err) {
        logger.error(`[craps] failed to render post-roll: ${err}`);
    }
}

function pickNextShooter(state) {
    const order = state.shooterOrder;
    if (!order.length) return state.shooterId;
    const idx = order.indexOf(state.shooterId);
    if (idx === -1) return order[0];
    return order[(idx + 1) % order.length];
}

function displayNameFor(state, userId) {
    const bet = state.bets.find(b => b.userId === userId);
    if (bet) return bet.username;
    if (userId === state.creatorId) return state.creatorUsername;
    return state.totals[userId]?.username || "the next shooter";
}

async function endSession(client, channel, message, state, reason, interaction) {
    if (!client.crapsGames.has(state.channelId)) return;
    if (state.status === "ended") return;
    state.status = "ended";
    client.crapsGames.delete(state.channelId);
    if (state.collector) {
        try { state.collector.stop(reason); } catch (_) { /* ignore */ }
    }

    const refundsByUser = {};
    for (const bet of state.bets) {
        refundsByUser[bet.userId] = (refundsByUser[bet.userId] || 0) + bet.amount;
    }
    state.bets = [];

    const refundWrites = [];
    for (const [uid, amount] of Object.entries(refundsByUser)) {
        if (amount > 0) refundWrites.push(withUserLock(uid, () => db.add(`${uid}.balance`, amount)));
    }
    await Promise.all(refundWrites);

    const totalRefund = Object.values(refundsByUser).reduce((s, v) => s + v, 0);
    const reasonText = reason === "idle"
        ? `Session ended due to inactivity — refunded **${totalRefund.toLocaleString("en-US")}** ${CURRENCY_NAME} across standing bets.`
        : `Session ended — refunded **${totalRefund.toLocaleString("en-US")}** ${CURRENCY_NAME} across standing bets.`;

    let attachment;
    try {
        attachment = await drawCrapsTable(state, state.themeColors);
    } catch (err) {
        logger.warn(`[craps] failed to render final table: ${err}`);
    }

    const embed = new EmbedBuilder()
        .setAuthor({ name: `${state.creatorUsername}'s craps game`, iconURL: state.userAvatars[state.creatorId] })
        .setColor(state.themeColors.embedColor || 0x888888)
        .setDescription(reasonText)
        .setFooter({ text: `Players: ${state.shooterOrder.length}` })
        .setTimestamp();
    if (attachment) embed.setImage("attachment://craps.png");

    try {
        if (interaction) {
            await interaction.deferUpdate().catch(() => {});
            await interaction.editReply({ embeds: [embed], files: attachment ? [attachment] : [], components: [] });
        } else if (message) {
            await message.edit({ embeds: [embed], files: attachment ? [attachment] : [], components: [] });
        }
    } catch (err) {
        logger.warn(`[craps] failed to finalize session message: ${err}`);
    }

    await Promise.all(state.shooterOrder.map(uid => sendSessionDM(client, state, uid, refundsByUser[uid] || 0)));
}

async function sendSessionDM(client, state, userId, refunded) {
    const totals = state.totals[userId] || { wagered: 0, won: 0 };
    const net = totals.won;
    try {
        const dmUser = await client.users.fetch(userId);
        const balance = await db.get(`${userId}.balance`) ?? 0;
        const embed = new EmbedBuilder()
            .setTitle(net > 0 ? "Craps Results — You Won!" : (net < 0 ? "Craps Results — You Lost" : "Craps Results"))
            .setColor(net > 0 ? 0x00AA00 : (net < 0 ? 0xFF0000 : 0x888888))
            .setDescription([
                `**Total wagered:** ${totals.wagered.toLocaleString("en-US")} ${CURRENCY_NAME}`,
                refunded > 0 ? `**Refunded (standing bets):** ${refunded.toLocaleString("en-US")} ${CURRENCY_NAME}` : null,
                `**Net:** ${net >= 0 ? "+" : ""}${net.toLocaleString("en-US")} ${CURRENCY_NAME}`,
                "",
                `New balance: **${balance.toLocaleString("en-US")}** ${CURRENCY_NAME}.`,
            ].filter(Boolean).join("\n"))
            .setTimestamp();
        await sendDM(dmUser, { embeds: [embed] });
    } catch (err) {
        logger.warn(`[craps] could not DM ${userId}: ${err.message || err}`);
    }
}
