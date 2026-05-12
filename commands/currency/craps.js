const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, AttachmentBuilder } = require("discord.js");
const { addNewDBUser, db } = require("../../database");
const { CURRENCY_NAME, CRAPS_MIN_BET, CRAPS_MAX_BET, CRAPS_ROUND_TIMEOUT, CRAPS_ANIMATION_HOLD_MS } = require("../../config.js");
const { parseBet } = require("../../utils/betparse");
const { BET_DEFINITIONS, validateBetAllowed, resolveBets, rollDice } = require("../../utils/craps");
const { drawCrapsTable, drawDiceAnimation, drawPaytable } = require("../../utils/crapsCanvas");
const { getEquippedTheme } = require("../../themes/manager");
const { getThemeColors } = require("../../themes/resolver");
const { contributeToJackpot } = require("../../utils/jackpot");
const { randomHexColor } = require("../../utils/randomcolor");
const logger = require("../../utils/logger");
const { withUserLock } = require("../../utils/userlock");
const wait = require("node:timers/promises").setTimeout;

const PACKAGE_VERSION = require("../../package.json").version;

const CHIP_PRESETS = [
    { label: "10",  value: "10" },
    { label: "100", value: "100" },
    { label: "1k",  value: "1000" },
    { label: "10k", value: "10000" },
    { label: "100k", value: "100000" },
    { label: "Half balance", value: "half" },
    { label: "Max (all balance)", value: "max" },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName("craps")
        .setDescription(`Play a game of craps for ${CURRENCY_NAME}.`)
        .addSubcommand(s => s
            .setName("play")
            .setDescription(`Open or resume your craps session.`)
            .addStringOption(o => o.setName("bet").setDescription("Default chip size for this session.").setRequired(true)))
        .addSubcommand(s => s
            .setName("paytable")
            .setDescription("Show the full craps payout table.")),

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

async function handlePaytable(interaction) {
    await interaction.deferReply();
    const themeId = await getEquippedTheme(interaction.user.id);
    const themeColors = getThemeColors(themeId, "craps");
    const attachment = await drawPaytable(themeColors);
    const embed = new EmbedBuilder()
        .setColor(themeColors.embedColor || 0x0f4c25)
        .setTitle("Craps Paytable")
        .setImage("attachment://craps-paytable.png");
    await interaction.editReply({ embeds: [embed], files: [attachment] });
}

async function handlePlay(interaction) {
    const client = interaction.client;
    const user = interaction.user;
    const channelId = interaction.channelId;
    const sessionKey = `${channelId}:${user.id}`;

    const betStr = interaction.options.getString("bet");
    const chipSize = Number(await parseBet(betStr, user.id));

    if (isNaN(chipSize) || chipSize % 1 !== 0) {
        return interaction.reply({ embeds: [errorEmbed(user, client, `You must specify a whole-number ${CURRENCY_NAME} amount.`)], ephemeral: true });
    }
    if (CRAPS_MIN_BET && chipSize < CRAPS_MIN_BET) {
        return interaction.reply({ embeds: [errorEmbed(user, client, `You must bet at least ${CRAPS_MIN_BET.toLocaleString('en-US')} ${CURRENCY_NAME}!`)], ephemeral: true });
    }
    if (CRAPS_MAX_BET && chipSize > CRAPS_MAX_BET) {
        return interaction.reply({ embeds: [errorEmbed(user, client, `You can bet at most ${CRAPS_MAX_BET.toLocaleString('en-US')} ${CURRENCY_NAME}!`)], ephemeral: true });
    }

    const dbUser = await db.get(user.id);
    if (!dbUser) {
        await addNewDBUser(user);
        return interaction.reply({ embeds: [errorEmbed(user, client, `You don't have an account yet — try the /daily command first.`)], ephemeral: true });
    }
    if ((dbUser.balance || 0) < chipSize) {
        return interaction.reply({ embeds: [errorEmbed(user, client, `You don't have enough ${CURRENCY_NAME} for that chip size!`)], ephemeral: true });
    }
    if (client.crapsGames.has(sessionKey)) {
        return interaction.reply({ embeds: [errorEmbed(user, client, `You already have a craps session in this channel. End it before starting a new one.`)], ephemeral: true });
    }

    await interaction.deferReply();

    const themeId = await getEquippedTheme(user.id);
    const themeColors = getThemeColors(themeId, "craps");

    const state = {
        userId: user.id,
        username: user.displayName,
        channelId,
        messageId: null,
        chipSize,
        phase: "comeout",
        point: null,
        bets: [],
        lastRoll: null,
        totalWagered: 0,
        totalWon: 0,
        themeId,
        themeColors,
        avatarUrl: user.displayAvatarURL({ dynamic: true, extension: "png", size: 128 }),
        chipColor: randomHexColor(),
    };

    logger.info(`${user.username}(${user.id}) opened a craps session with chip size ${chipSize} ${CURRENCY_NAME}.`);

    const message = await interaction.editReply(await renderMessage(state, "Place your bets and roll when ready. Pass, Don't Pass, Field, and one-roll props are available before the come-out."));
    state.messageId = message.id;
    client.crapsGames.set(sessionKey, state);

    const collector = message.createMessageComponentCollector({
        filter: i => i.user.id === state.userId,
        idle: CRAPS_ROUND_TIMEOUT,
    });

    collector.on("collect", async (i) => {
        try {
            await routeInteraction(i, state, sessionKey, client);
        } catch (err) {
            logger.error(`[craps] handler error: ${err && err.stack || err}`);
            try {
                if (!i.replied && !i.deferred) await i.reply({ content: "Something went wrong handling that action.", ephemeral: true });
            } catch (_) { /* ignore */ }
        }
    });

    collector.on("end", async (_collected, reason) => {
        if (!client.crapsGames.has(sessionKey)) return; // already ended cleanly
        if (reason === "idle" || reason === "time") {
            await endSession(state, sessionKey, client, message, "idle");
        }
    });
}

async function renderMessage(state, description = "") {
    const attachment = await drawCrapsTable(state, state.themeColors);
    const embed = new EmbedBuilder()
        .setAuthor({ name: state.username, iconURL: state.avatarUrl })
        .setColor(state.themeColors.embedColor || randomHexColor())
        .setImage("attachment://craps.png")
        .setFooter({ text: `Chip Size: ${state.chipSize.toLocaleString('en-US')} ${CURRENCY_NAME}` });
    if (description) embed.setDescription(description);
    return { embeds: [embed], files: [attachment], components: buildComponents(state) };
}

function buildComponents(state, opts = {}) {
    const disableAll = !!opts.disableAll;
    const phase = state.phase;

    const lineRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("craps_pass").setLabel("Pass").setStyle(ButtonStyle.Success).setDisabled(disableAll || phase !== "comeout"),
        new ButtonBuilder().setCustomId("craps_dontPass").setLabel("Don't Pass").setStyle(ButtonStyle.Danger).setDisabled(disableAll || phase !== "comeout"),
        new ButtonBuilder().setCustomId("craps_come").setLabel("Come").setStyle(ButtonStyle.Success).setDisabled(disableAll || phase !== "point"),
        new ButtonBuilder().setCustomId("craps_dontCome").setLabel("Don't Come").setStyle(ButtonStyle.Danger).setDisabled(disableAll || phase !== "point"),
        new ButtonBuilder().setCustomId("craps_field").setLabel("Field").setStyle(ButtonStyle.Primary).setDisabled(disableAll),
    );

    const categoryRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("craps_cat_place").setLabel("Place ▾").setStyle(ButtonStyle.Secondary).setDisabled(disableAll || phase !== "point"),
        new ButtonBuilder().setCustomId("craps_cat_hard").setLabel("Hard Ways ▾").setStyle(ButtonStyle.Secondary).setDisabled(disableAll || phase !== "point"),
        new ButtonBuilder().setCustomId("craps_cat_odds").setLabel("Odds ▾").setStyle(ButtonStyle.Secondary).setDisabled(disableAll || phase !== "point"),
        new ButtonBuilder().setCustomId("craps_cat_props").setLabel("Props ▾").setStyle(ButtonStyle.Secondary).setDisabled(disableAll),
        new ButtonBuilder().setCustomId("craps_cat_big").setLabel("Big 6/8 ▾").setStyle(ButtonStyle.Secondary).setDisabled(disableAll),
    );

    const sessionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("craps_chip").setLabel("Chip Size").setStyle(ButtonStyle.Secondary).setEmoji("🎰").setDisabled(disableAll),
        new ButtonBuilder().setCustomId("craps_roll").setLabel("Roll").setStyle(ButtonStyle.Success).setEmoji("🎲").setDisabled(disableAll || state.bets.length === 0),
        new ButtonBuilder().setCustomId("craps_clear").setLabel("Clear Bets").setStyle(ButtonStyle.Danger).setDisabled(disableAll || state.bets.length === 0),
        new ButtonBuilder().setCustomId("craps_end").setLabel("End").setStyle(ButtonStyle.Secondary).setDisabled(disableAll),
    );

    return [lineRow, categoryRow, sessionRow];
}

async function routeInteraction(i, state, sessionKey, client) {
    const id = i.customId;
    if (id.startsWith("craps_cat_")) {
        return openCategoryMenu(i, state, id.replace("craps_cat_", ""));
    }
    switch (id) {
        case "craps_pass":     return placeBet(i, state, "pass");
        case "craps_dontPass": return placeBet(i, state, "dontPass");
        case "craps_come":     return placeBet(i, state, "come");
        case "craps_dontCome": return placeBet(i, state, "dontCome");
        case "craps_field":    return placeBet(i, state, "field");
        case "craps_chip":     return openChipMenu(i, state);
        case "craps_roll":     return handleRoll(i, state, sessionKey, client);
        case "craps_clear":    return handleClearBets(i, state);
        case "craps_end":      return endSession(state, sessionKey, client, await i.message.fetch(), "end", i);
    }
}

async function placeBet(i, state, betKey) {
    const user = i.user;
    const check = validateBetAllowed(betKey, state.phase, state.point, state.bets);
    if (!check.allowed) {
        return i.reply({ content: check.reason, ephemeral: true });
    }

    await i.deferUpdate();

    // Lock around the read-modify-write so concurrent commands (/bank withdraw,
    // /slots) can't drain the wallet between the balance check and the deduction.
    const ok = await withUserLock(user.id, async () => {
        const balance = await db.get(`${user.id}.balance`) ?? 0;
        if (balance < state.chipSize) return false;
        await db.sub(`${user.id}.balance`, state.chipSize);
        return true;
    });
    if (!ok) {
        return i.followUp({ content: `You don't have enough ${CURRENCY_NAME} to place that bet.`, ephemeral: true });
    }
    await db.add(`${user.id}.stats.craps.totalBet`, state.chipSize);
    state.bets.push({ betKey, amount: state.chipSize, cameToPoint: null });
    state.totalWagered += state.chipSize;
    await contributeToJackpot(state.chipSize);

    const def = BET_DEFINITIONS[betKey];
    await i.editReply(await renderMessage(state, `Placed **${state.chipSize.toLocaleString('en-US')}** ${CURRENCY_NAME} on **${def.label}**.`));
}

async function openChipMenu(i, state) {
    const select = new StringSelectMenuBuilder()
        .setCustomId("craps_chip_select")
        .setPlaceholder(`Current: ${state.chipSize.toLocaleString('en-US')} ${CURRENCY_NAME}`)
        .addOptions(CHIP_PRESETS.map(p => ({ label: p.label, value: p.value })));
    const row = new ActionRowBuilder().addComponents(select);

    await i.reply({ content: "Pick a chip size:", components: [row], ephemeral: true });
    const reply = await i.fetchReply();

    try {
        const pick = await reply.awaitMessageComponent({
            filter: c => c.user.id === state.userId && c.customId === "craps_chip_select",
            time: 30000,
        });
        const balance = await db.get(`${state.userId}.balance`) ?? 0;
        let newSize = 0;
        const raw = pick.values[0];
        if (raw === "max") newSize = balance;
        else if (raw === "half") newSize = Math.floor(balance / 2);
        else newSize = parseInt(raw, 10);

        if (!Number.isFinite(newSize) || newSize < (CRAPS_MIN_BET || 1)) {
            return pick.update({ content: `Chip size must be at least ${(CRAPS_MIN_BET || 1).toLocaleString('en-US')} ${CURRENCY_NAME}.`, components: [] });
        }
        if (CRAPS_MAX_BET && newSize > CRAPS_MAX_BET) newSize = CRAPS_MAX_BET;
        state.chipSize = newSize;
        await pick.deferUpdate();
        await i.deleteReply().catch(() => {});

        const mainMsg = await i.channel.messages.fetch(state.messageId).catch(() => null);
        if (mainMsg) await mainMsg.edit(await renderMessage(state));
    } catch (_) {
        await reply.edit({ content: "Chip size unchanged (timed out).", components: [] }).catch(() => {});
    }
}

async function openCategoryMenu(i, state, category) {
    let options = [];
    if (category === "place") {
        options = ["place_4", "place_5", "place_6", "place_8", "place_9", "place_10"];
    } else if (category === "hard") {
        options = ["hard_4", "hard_6", "hard_8", "hard_10"];
    } else if (category === "props") {
        options = ["any7", "anyCraps", "yo", "two", "three", "twelve", "ce", "horn"];
    } else if (category === "big") {
        options = ["big6", "big8"];
    } else if (category === "odds") {
        // Build odds options dynamically based on parent bets that exist.
        options = [];
        if (state.bets.some(b => b.betKey === "pass")) options.push("pass_odds");
        if (state.bets.some(b => b.betKey === "dontPass")) options.push("dontPass_odds");
        const comePoints = state.bets.filter(b => b.betKey === "come" && b.cameToPoint != null).map(b => b.cameToPoint);
        const dcPoints   = state.bets.filter(b => b.betKey === "dontCome" && b.cameToPoint != null).map(b => b.cameToPoint);
        for (const p of comePoints) options.push(`come_odds_${p}`);
        for (const p of dcPoints)   options.push(`dontCome_odds_${p}`);
        if (options.length === 0) {
            return i.reply({ content: "No parent bets eligible for odds yet. Place a Pass/Don't Pass first, or wait for a Come/Don't Come bet to travel to a point.", ephemeral: true });
        }
    }

    const select = new StringSelectMenuBuilder()
        .setCustomId(`craps_sub_${category}`)
        .setPlaceholder(`Choose a ${category} bet`)
        .addOptions(options.map(k => {
            const def = BET_DEFINITIONS[k];
            const payoutStr = def.payout ? `${def.payout.num}:${def.payout.den}` : "true odds";
            return { label: def.label, value: k, description: `Pays ${payoutStr}` };
        }));
    const row = new ActionRowBuilder().addComponents(select);

    await i.reply({ content: `Choose a ${category} bet (chip size: ${state.chipSize.toLocaleString('en-US')} ${CURRENCY_NAME}):`, components: [row], ephemeral: true });
    const reply = await i.fetchReply();

    try {
        const pick = await reply.awaitMessageComponent({
            filter: c => c.user.id === state.userId && c.customId === `craps_sub_${category}`,
            time: 30000,
        });
        const betKey = pick.values[0];

        const check = validateBetAllowed(betKey, state.phase, state.point, state.bets);
        if (!check.allowed) {
            return pick.update({ content: check.reason, components: [] });
        }
        const ok = await withUserLock(state.userId, async () => {
            const balance = await db.get(`${state.userId}.balance`) ?? 0;
            if (balance < state.chipSize) return false;
            await db.sub(`${state.userId}.balance`, state.chipSize);
            return true;
        });
        if (!ok) {
            return pick.update({ content: `You don't have enough ${CURRENCY_NAME} for that bet.`, components: [] });
        }
        await db.add(`${state.userId}.stats.craps.totalBet`, state.chipSize);
        state.bets.push({ betKey, amount: state.chipSize, cameToPoint: null });
        state.totalWagered += state.chipSize;
        await contributeToJackpot(state.chipSize);

        const def = BET_DEFINITIONS[betKey];
        await pick.deferUpdate();
        await i.deleteReply().catch(() => {});

        const mainMsg = await i.channel.messages.fetch(state.messageId).catch(() => null);
        if (mainMsg) await mainMsg.edit(await renderMessage(state, `Placed **${state.chipSize.toLocaleString('en-US')}** ${CURRENCY_NAME} on **${def.label}**.`));
    } catch (_) {
        await reply.edit({ content: "Bet menu closed (timed out).", components: [] }).catch(() => {});
    }
}

async function handleClearBets(i, state) {
    // Take ownership of the bet array before any await so a concurrent
    // handleRoll can't resolve the same bets we're about to refund.
    const toRefund = state.bets;
    state.bets = [];
    await i.deferUpdate();
    let refund = 0;
    for (const bet of toRefund) refund += bet.amount;
    if (refund > 0) await withUserLock(state.userId, () => db.add(`${state.userId}.balance`, refund));
    await i.editReply(await renderMessage(state, `Cleared all standing bets — refunded **${refund.toLocaleString('en-US')}** ${CURRENCY_NAME}.`));
}

async function handleRoll(i, state, sessionKey, client) {
    if (state.bets.length === 0) {
        return i.reply({ content: "Place at least one bet before rolling.", ephemeral: true });
    }
    // Snapshot bets BEFORE any await — otherwise a rapid Roll+Clear double-click
    // can interleave: this handler yields, handleClearBets empties state.bets
    // and refunds, then this handler resumes and rolls against an empty array
    // (or worse, resolves stale bets the user already got refunded for).
    const lockedBets = state.bets;
    state.bets = [];
    await i.deferUpdate();

    // Show dice GIF while keeping the same embed (swap image attachment).
    const roll = rollDice();
    const gif = await drawDiceAnimation(roll.d1, roll.d2, state.themeColors);
    const tumbleEmbed = new EmbedBuilder()
        .setAuthor({ name: state.username, iconURL: state.avatarUrl })
        .setColor(state.themeColors.embedColor || randomHexColor())
        .setDescription(`🎲 Rolling...`)
        .setImage("attachment://craps-roll.gif")
        .setFooter({ text: `Chip Size: ${state.chipSize.toLocaleString('en-US')} ${CURRENCY_NAME}` });

    await i.editReply({ embeds: [tumbleEmbed], files: [gif], components: buildComponents(state, { disableAll: true }) });
    await wait(CRAPS_ANIMATION_HOLD_MS);

    const oldPhase = state.phase;
    const oldPoint = state.point;
    const { results, newPhase, newPoint } = resolveBets(lockedBets, roll, oldPhase, oldPoint);

    let totalWon = 0;
    let totalLost = 0;
    let totalBalanceChange = 0;
    let winCount = 0;
    let lossCount = 0;
    let pushCount = 0;
    let profitChange = 0;
    let maxWin = 0;
    let maxLoss = 0;
    const lines = [];

    const [currentBiggestWin, currentBiggestLoss] = await Promise.all([
        db.get(`${state.userId}.stats.craps.biggestWin`),
        db.get(`${state.userId}.stats.craps.biggestLoss`),
    ]);
    const prevBiggestWin = currentBiggestWin || 0;
    const prevBiggestLoss = currentBiggestLoss || 0;

    for (let idx = 0; idx < results.length; idx++) {
        const r = results[idx];
        const def = BET_DEFINITIONS[r.betKey];
        if (r.status === "win") {
            totalBalanceChange += r.payoutAmount;
            const winnings = r.payoutAmount - r.originalAmount;
            totalWon += winnings;
            winCount++;
            profitChange += winnings;
            if (winnings > maxWin) maxWin = winnings;
            lines.push(`✅ **${def.label}** won **${winnings.toLocaleString('en-US')}** ${CURRENCY_NAME}`);
        } else if (r.status === "lose") {
            totalLost += r.originalAmount;
            lossCount++;
            profitChange -= r.originalAmount;
            if (r.originalAmount > maxLoss) maxLoss = r.originalAmount;
            lines.push(`❌ **${def.label}** lost **${r.originalAmount.toLocaleString('en-US')}** ${CURRENCY_NAME}`);
        } else if (r.status === "push") {
            totalBalanceChange += r.payoutAmount;
            pushCount++;
            lines.push(`➖ **${def.label}** pushed (stake returned)`);
        } else if (r.movedToPoint) {
            lockedBets[idx].cameToPoint = r.movedToPoint;
            lines.push(`➡️ **${def.label}** traveled to **${r.movedToPoint}**`);
        }
    }

    // Surviving bets (not won/lost/pushed) return to the table.
    state.bets = lockedBets.filter((_, idx) => !results[idx].remove);
    state.totalWon += totalWon;
    state.phase = newPhase;
    state.point = newPoint;
    state.lastRoll = { d1: roll.d1, d2: roll.d2, total: roll.total };

    const pointJustHit = oldPhase === "point" && newPhase === "comeout" && roll.total === oldPoint;
    const sevenedOut   = oldPhase === "point" && newPhase === "comeout" && roll.total === 7;
    const pointJustSet = oldPhase === "comeout" && newPhase === "point";

    const dbWrites = [
        withUserLock(state.userId, () => db.add(`${state.userId}.balance`, totalBalanceChange)),
        db.add(`${state.userId}.stats.craps.rolls`, 1),
    ];
    if (winCount) {
        dbWrites.push(db.add(`${state.userId}.stats.craps.wins`, winCount));
        dbWrites.push(db.add(`${state.userId}.stats.craps.profit`, profitChange));
        if (maxWin > prevBiggestWin) dbWrites.push(db.set(`${state.userId}.stats.craps.biggestWin`, maxWin));
    }
    if (lossCount) {
        dbWrites.push(db.add(`${state.userId}.stats.craps.losses`, lossCount));
        if (!winCount) dbWrites.push(db.add(`${state.userId}.stats.craps.profit`, profitChange));
        if (maxLoss > prevBiggestLoss) dbWrites.push(db.set(`${state.userId}.stats.craps.biggestLoss`, maxLoss));
    }
    if (pushCount) dbWrites.push(db.add(`${state.userId}.stats.craps.pushes`, pushCount));
    if (pointJustHit) dbWrites.push(db.add(`${state.userId}.stats.craps.pointsHit`, 1));
    if (sevenedOut)   dbWrites.push(db.add(`${state.userId}.stats.craps.sevenOuts`, 1));
    await Promise.all(dbWrites);

    // Build resolution description
    let header = `🎲 Rolled **${roll.d1}** + **${roll.d2}** = **${roll.total}**`;
    if (roll.isHard) header += " (hard)";
    if (pointJustSet) header += ` — point is **${newPoint}**!`;
    else if (pointJustHit) header += ` — **point hit!**`;
    else if (sevenedOut) header += ` — **seven out!**`;

    const desc = [header, "", ...(lines.length ? lines : ["No bets resolved this roll."])].join("\n");

    // Refresh message with table image again
    await i.editReply(await renderMessage(state, desc));

    // Ensure we replace the GIF attachment by sending the PNG explicitly.
    // (renderMessage already attaches craps.png; the editReply replaces files.)
}

async function endSession(state, sessionKey, client, message, reason, interaction = null) {
    if (!client.crapsGames.has(sessionKey)) return;
    client.crapsGames.delete(sessionKey);

    const toRefund = state.bets;
    state.bets = [];
    let refund = 0;
    for (const bet of toRefund) refund += bet.amount;
    if (refund > 0) await withUserLock(state.userId, () => db.add(`${state.userId}.balance`, refund));

    const reasonText = reason === "idle"
        ? `Round ended due to inactivity — refunded **${refund.toLocaleString('en-US')}** ${CURRENCY_NAME}.`
        : `Session ended — refunded **${refund.toLocaleString('en-US')}** ${CURRENCY_NAME}.`;

    const attachment = await drawCrapsTable(state, state.themeColors);
    const embed = new EmbedBuilder()
        .setAuthor({ name: state.username, iconURL: state.avatarUrl })
        .setColor(state.themeColors.embedColor || 0x888888)
        .setDescription(reasonText)
        .setImage("attachment://craps.png")
        .setFooter({ text: `Total wagered: ${state.totalWagered.toLocaleString('en-US')} ${CURRENCY_NAME} · Won: ${state.totalWon.toLocaleString('en-US')}` });

    if (interaction) {
        await interaction.deferUpdate().catch(() => {});
        await interaction.editReply({ embeds: [embed], files: [attachment], components: [] }).catch(() => {});
    } else if (message) {
        await message.edit({ embeds: [embed], files: [attachment], components: [] }).catch(() => {});
    }
}
