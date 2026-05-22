const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require("discord.js");
const { addNewDBUser, db } = require("../../database");
const { CURRENCY_NAME, ROULETTE_MIN_BET, ROULETTE_MAX_BET, ROULETTE_IDLE_TIMEOUT } = require("../../config.js");
const { openBetModal, resolveBet } = require("../../utils/betModal");
const {
  drawRouletteTable,
  drawResult,
  spinWheel,
  getRedBlack,
  validateBet,
  resolveBets,
} = require("../../utils/roulette");
const { getEquippedTheme } = require("../../themes/manager");
const { getThemeColors } = require("../../themes/resolver");
const { contributeToJackpot } = require("../../utils/jackpot");
const { withUserLock } = require("../../utils/userlock");
const { randomHexColor } = require("../../utils/randomcolor");
const { sendDM } = require("../../utils/dm");
const logger = require("../../utils/logger");
const wait = require("node:timers/promises").setTimeout;
const { recordGameResult } = require("../../utils/gameResults");

const PACKAGE_VERSION = require("../../package.json").version;

// Theme tokens like textWin/pocketRed are stored as `#rrggbb` strings;
// Discord embeds need integers. embedColor is already an int.
function themeColor(c, fallback = 0) {
  if (typeof c === "number") return c;
  if (!c) return fallback;
  return parseInt(String(c).replace(/^#/, ""), 16) || fallback;
}

const BET_DEFINITIONS = {
  red:     { label: "Red",        style: ButtonStyle.Danger,    chip: "red" },
  black:   { label: "Black",      style: ButtonStyle.Secondary, chip: "black" },
  even:    { label: "Even",       style: ButtonStyle.Primary,   chip: "even" },
  odd:     { label: "Odd",        style: ButtonStyle.Primary,   chip: "odd" },
  low:     { label: "Low 1-18",   style: ButtonStyle.Primary,   chip: "low" },
  high:    { label: "High 19-36", style: ButtonStyle.Primary,   chip: "high" },
  dozen1:  { label: "Dozen 1",    style: ButtonStyle.Primary,   chip: "dozen1" },
  dozen2:  { label: "Dozen 2",    style: ButtonStyle.Primary,   chip: "dozen2" },
  dozen3:  { label: "Dozen 3",    style: ButtonStyle.Primary,   chip: "dozen3" },
  column1: { label: "Col 1",      style: ButtonStyle.Primary,   chip: "column1" },
  column2: { label: "Col 2",      style: ButtonStyle.Primary,   chip: "column2" },
  column3: { label: "Col 3",      style: ButtonStyle.Primary,   chip: "column3" },
  straight:{ label: "Straight #", style: ButtonStyle.Success,   chip: null },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("roulette")
    .setDescription(`Play a game of roulette for ${CURRENCY_NAME}.`)
    .addStringOption(option =>
      option.setName("amount")
        .setDescription("Optional default bet amount (changeable via the Change Bet button).")
        .setRequired(false)),

  async execute(interaction) {
    const client = interaction.client;
    const user = interaction.user;
    const channelId = interaction.channelId;

    if (client.rouletteGames.has(channelId)) {
      return interaction.reply({ embeds: [errorEmbed(user, client, "A roulette game is already running in this channel — click a bet button on the table to join.")], ephemeral: true });
    }

    const dbUser = await db.get(user.id);
    if (!dbUser) {
      await addNewDBUser(user);
    }

    // Slash-supplied default bet is stashed as the raw expression so that
    // subsequent bet-button clicks re-resolve it against the live balance.
    let initialExpression = null;
    const amountStr = interaction.options.getString("amount");
    if (amountStr) {
      const check = await resolveBet(amountStr, user.id, { min: ROULETTE_MIN_BET, max: ROULETTE_MAX_BET, requireBalance: false });
      if (!check.ok) {
        return interaction.reply({ embeds: [errorEmbed(user, client, check.reason)], ephemeral: true });
      }
      initialExpression = amountStr.trim();
    }

    return handleNewGame(interaction, client, user, initialExpression);
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

async function resolveChipColor(interaction, user) {
  if (user.accentColor) return `#${user.accentColor.toString(16).padStart(6, "0")}`;
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (member && member.displayHexColor && member.displayHexColor !== "#000000") return member.displayHexColor;
  return randomHexColor();
}

function formatBetType(type, numberValue) {
  if (type === "straight") return `Straight on ${numberValue}`;
  return BET_DEFINITIONS[type]?.label ?? type;
}

function buildBetsDescription(bets) {
  if (!bets.length) return "No bets yet";
  const byUser = {};
  for (const bet of bets) {
    if (!byUser[bet.userId]) byUser[bet.userId] = { displayName: bet.username, total: 0, entries: [] };
    byUser[bet.userId].total += bet.amount;
    byUser[bet.userId].entries.push(`${formatBetType(bet.type, bet.numberValue)} (${bet.amount.toLocaleString("en-US")} ${CURRENCY_NAME})`);
  }
  return Object.values(byUser)
    .map(u => `• ${u.displayName}: ${u.total.toLocaleString("en-US")} on ${u.entries.join(", ")}`)
    .join("\n");
}

async function handleNewGame(interaction, client, user, initialExpression = null) {
  const channel = interaction.channel;
  const channelId = channel.id;

  await interaction.deferReply();

  const themeId = await getEquippedTheme(user.id);
  const themeColors = getThemeColors(themeId, "roulette");
  const avatarUrl = user.displayAvatarURL({ extension: "png", size: 256 });
  const chipColor = await resolveChipColor(interaction, user);

  const state = {
    channelId,
    messageId: null,
    creatorId: user.id,
    creatorUsername: user.displayName,
    bets: [],
    userAvatars: { [user.id]: avatarUrl },
    userColors: { [user.id]: chipColor },
    // Cached as raw expression strings; resolved against the live balance
    // each time a bet button is clicked.
    userBetAmounts: initialExpression ? { [user.id]: initialExpression } : {},
    playerOrder: [user.id],
    totals: { [user.id]: { wagered: 0, won: 0, username: user.displayName } },
    themeId,
    themeColors,
    status: "betting",
    collector: null,
  };

  logger.log(`${user.username} (${user.id}) opened a roulette game in #${channel.name}.`);

  const message = await interaction.editReply(await renderMessage(state, "🎡 New roulette game — place a bet below to begin."));
  state.messageId = message.id;
  client.rouletteGames.set(channelId, state);

  attachCollector(client, channel, message, state);
}

async function renderMessage(state, description = "") {
  const attachment = await drawRouletteTable(state.bets, state.userAvatars, state.userColors, state.themeColors);
  const embed = new EmbedBuilder()
    .setAuthor({ name: `${state.creatorUsername}'s Roulette`, iconURL: state.userAvatars[state.creatorId] })
    .setColor(state.themeColors.embedColor || randomHexColor())
    .setTitle("Place Your Bets!")
    .setDescription(`${description ? description + "\n\n" : ""}**Current Bets:**\n${buildBetsDescription(state.bets)}`)
    .setImage("attachment://roulette.png")
    .setFooter({ text: `${state.playerOrder.length} player${state.playerOrder.length === 1 ? "" : "s"} · Creator: ${state.creatorUsername}` })
    .setTimestamp();
  return { embeds: [embed], files: [attachment], components: buildComponents(state) };
}

function buildComponents(state, opts = {}) {
  const disableAll = !!opts.disableAll || state.status !== "betting";

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("roulette_bet_red").setLabel("Red").setStyle(ButtonStyle.Danger).setDisabled(disableAll),
    new ButtonBuilder().setCustomId("roulette_bet_black").setLabel("Black").setStyle(ButtonStyle.Secondary).setDisabled(disableAll),
    new ButtonBuilder().setCustomId("roulette_bet_even").setLabel("Even").setStyle(ButtonStyle.Primary).setDisabled(disableAll),
    new ButtonBuilder().setCustomId("roulette_bet_odd").setLabel("Odd").setStyle(ButtonStyle.Primary).setDisabled(disableAll),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("roulette_bet_low").setLabel("Low 1-18").setStyle(ButtonStyle.Primary).setDisabled(disableAll),
    new ButtonBuilder().setCustomId("roulette_bet_high").setLabel("High 19-36").setStyle(ButtonStyle.Primary).setDisabled(disableAll),
    new ButtonBuilder().setCustomId("roulette_bet_dozen1").setLabel("Dozen 1").setStyle(ButtonStyle.Primary).setDisabled(disableAll),
    new ButtonBuilder().setCustomId("roulette_bet_dozen2").setLabel("Dozen 2").setStyle(ButtonStyle.Primary).setDisabled(disableAll),
    new ButtonBuilder().setCustomId("roulette_bet_dozen3").setLabel("Dozen 3").setStyle(ButtonStyle.Primary).setDisabled(disableAll),
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("roulette_bet_column1").setLabel("Col 1").setStyle(ButtonStyle.Primary).setDisabled(disableAll),
    new ButtonBuilder().setCustomId("roulette_bet_column2").setLabel("Col 2").setStyle(ButtonStyle.Primary).setDisabled(disableAll),
    new ButtonBuilder().setCustomId("roulette_bet_column3").setLabel("Col 3").setStyle(ButtonStyle.Primary).setDisabled(disableAll),
    new ButtonBuilder().setCustomId("roulette_bet_straight").setLabel("Straight #").setStyle(ButtonStyle.Success).setDisabled(disableAll),
  );
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("roulette_spin")
      .setLabel("Spin Now")
      .setEmoji("🎡")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disableAll || state.bets.length === 0),
    new ButtonBuilder()
      .setCustomId("roulette_changeBet")
      .setLabel("Change Bet")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disableAll),
    new ButtonBuilder()
      .setCustomId("roulette_wipe")
      .setLabel("Wipe My Bets")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disableAll || state.bets.length === 0),
    new ButtonBuilder()
      .setCustomId("roulette_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disableAll),
  );

  return [row1, row2, row3, row4];
}

function attachCollector(client, channel, message, state) {
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    idle: ROULETTE_IDLE_TIMEOUT,
  });
  state.collector = collector;

  collector.on("collect", async (i) => {
    try {
      if (i.customId.startsWith("roulette_bet_")) {
        const betKey = i.customId.replace("roulette_bet_", "");
        return handleBetButton(i, state, betKey, client);
      }
      if (i.customId === "roulette_changeBet") {
        return handleChangeBet(i, state);
      }
      if (i.customId === "roulette_wipe") {
        return handleWipeBets(i, state);
      }
      if (i.customId === "roulette_spin") {
        if (i.user.id !== state.creatorId) {
          return i.reply({ content: `Only **${state.creatorUsername}** (who started this game) can spin.`, ephemeral: true });
        }
        return handleSpin(i, state, client);
      }
      if (i.customId === "roulette_cancel") {
        if (i.user.id !== state.creatorId) {
          return i.reply({ content: `Only **${state.creatorUsername}** (who started this game) can cancel.`, ephemeral: true });
        }
        return endSession(client, channel, message, state, "cancelled", i);
      }
    } catch (err) {
      logger.error(`[roulette] handler error: ${err && err.stack || err}`);
      try {
        if (!i.replied && !i.deferred) await i.reply({ content: "Something went wrong handling that action.", ephemeral: true });
      } catch (_) { /* ignore */ }
    }
  });

  collector.on("end", async (_collected, reason) => {
    if (!client.rouletteGames.has(state.channelId)) return;
    if (reason === "idle" || reason === "time") {
      await endSession(client, channel, message, state, "idle", null);
    }
  });
}

async function handleBetButton(buttonInt, state, betKey, client) {
  const def = BET_DEFINITIONS[betKey];
  if (!def) {
    return buttonInt.reply({ content: "Unknown bet type.", ephemeral: true });
  }

  const cachedExpression = state.userBetAmounts[buttonInt.user.id];

  // Straight always opens modal (needs number). Non-straight uses cache when
  // present — re-resolve the cached expression so dynamic bets like
  // `max * 0.2` always reflect the live balance.
  if (betKey !== "straight" && cachedExpression) {
    const resolved = await resolveBet(cachedExpression, buttonInt.user.id, {
      min: ROULETTE_MIN_BET,
      max: ROULETTE_MAX_BET,
    });
    if (!resolved.ok) {
      delete state.userBetAmounts[buttonInt.user.id];
      return buttonInt.reply({
        embeds: [errorEmbed(buttonInt.user, client, `${resolved.reason} Click the bet button again to enter a new amount.`)],
        ephemeral: true,
      });
    }
    return handleAddBet(buttonInt, client, buttonInt.user, betKey, null, resolved.amount, state);
  }

  const modalOpts = {
    title: `Place ${def.label} bet`,
    min: ROULETTE_MIN_BET,
    max: ROULETTE_MAX_BET,
  };
  if (betKey === "straight") {
    modalOpts.extras = [{
      customId: "number",
      label: "Number (0-36)",
      placeholder: "e.g. 17",
      maxLength: 2,
    }];
    if (cachedExpression) modalOpts.defaultAmount = cachedExpression;
  }

  const result = await openBetModal(buttonInt, modalOpts);
  if (!result) return;
  const { amount, expression, submit } = result;

  let numberValue = null;
  if (betKey === "straight") {
    const raw = submit.fields.getTextInputValue("number").trim();
    numberValue = parseInt(raw, 10);
    const check = validateBet("straight", numberValue);
    if (!check.allowed) {
      return submit.reply({ embeds: [errorEmbed(submit.user, client, check.reason)], ephemeral: true });
    }
  }

  const current = client.rouletteGames.get(state.channelId);
  if (!current || current.status === "ended") {
    return submit.reply({ embeds: [errorEmbed(submit.user, client, "This roulette game is no longer active.")], ephemeral: true });
  }
  if (current.status !== "betting") {
    return submit.reply({ embeds: [errorEmbed(submit.user, client, "The wheel is spinning — try again next round.")], ephemeral: true });
  }

  current.userBetAmounts[submit.user.id] = expression;
  return handleAddBet(submit, client, submit.user, betKey, numberValue, amount, current);
}

async function handleChangeBet(buttonInt, state) {
  const client = buttonInt.client;
  const cachedExpression = state.userBetAmounts[buttonInt.user.id];
  const result = await openBetModal(buttonInt, {
    title: "Set roulette bet amount",
    min: ROULETTE_MIN_BET,
    max: ROULETTE_MAX_BET,
    defaultAmount: cachedExpression || undefined,
  });
  if (!result) return;
  const { amount, expression, submit } = result;

  const current = client.rouletteGames.get(state.channelId);
  if (!current || current.status === "ended") {
    return submit.reply({ embeds: [errorEmbed(submit.user, client, "This roulette game is no longer active.")], ephemeral: true });
  }
  current.userBetAmounts[submit.user.id] = expression;

  const embed = new EmbedBuilder()
    .setAuthor({ name: "Bet amount updated", iconURL: submit.user.displayAvatarURL({ dynamic: true }) })
    .setColor(current.themeColors.embedColor || randomHexColor())
    .setDescription(`Your bet amount is now **${amount.toLocaleString("en-US")}** ${CURRENCY_NAME}. Click any bet button to place it.`)
    .setTimestamp();
  return submit.reply({ embeds: [embed], ephemeral: true });
}

async function handleWipeBets(buttonInt, state) {
  const userId = buttonInt.user.id;
  const userBets = state.bets.filter(b => b.userId === userId);
  if (userBets.length === 0) {
    return buttonInt.reply({ content: "You don't have any standing bets to wipe.", ephemeral: true });
  }

  const refund = userBets.reduce((sum, b) => sum + b.amount, 0);
  state.bets = state.bets.filter(b => b.userId !== userId);

  await withUserLock(userId, () => db.add(`${userId}.balance`, refund));
  if (state.totals[userId]) state.totals[userId].wagered -= refund;

  logger.log(`${buttonInt.user.username} (${userId}) wiped their roulette bets, refunded ${refund}.`);

  await buttonInt.deferUpdate().catch(() => {});
  try {
    const gameMessage = await buttonInt.channel.messages.fetch(state.messageId);
    await gameMessage.edit(await renderMessage(state, `**${buttonInt.user.displayName}** wiped their bets — refunded **${refund.toLocaleString("en-US")}** ${CURRENCY_NAME}.`));
    if (state.collector) state.collector.resetTimer();
  } catch (err) {
    logger.error(`[roulette] failed to update after wipe: ${err}`);
  }
}

async function handleAddBet(interaction, client, user, betKey, numberValue, amount, state) {
  const def = BET_DEFINITIONS[betKey];

  const debited = await withUserLock(user.id, async () => {
    const balance = await db.get(`${user.id}.balance`) ?? 0;
    if (balance < amount) return false;
    await db.sub(`${user.id}.balance`, amount);
    return true;
  });
  if (!debited) {
    return interaction.reply({ embeds: [errorEmbed(user, client, "Insufficient funds in wallet!")], ephemeral: true });
  }
  await db.add(`${user.id}.stats.roulette.totalBet`, amount);
  await contributeToJackpot(amount);

  if (!state.playerOrder.includes(user.id)) state.playerOrder.push(user.id);
  if (!state.userAvatars[user.id]) state.userAvatars[user.id] = user.displayAvatarURL({ extension: "png", size: 256 });
  if (!state.userColors[user.id]) state.userColors[user.id] = await resolveChipColor(interaction, user);
  if (!state.totals[user.id]) state.totals[user.id] = { wagered: 0, won: 0, username: user.displayName };
  state.totals[user.id].wagered += amount;

  const chipNumber = betKey === "straight" ? numberValue : def.chip;
  const existing = state.bets.find(b =>
    b.userId === user.id && b.type === betKey && b.number === chipNumber && b.numberValue === numberValue
  );
  if (existing) {
    existing.amount += amount;
  } else {
    state.bets.push({
      number: chipNumber,
      amount,
      userId: user.id,
      username: user.displayName,
      type: betKey,
      numberValue,
    });
  }

  logger.log(`${user.username} (${user.id}) bet ${amount} ${CURRENCY_NAME} on ${formatBetType(betKey, numberValue)} in roulette ${state.channelId}.`);

  await interaction.deferUpdate().catch(() => {});

  try {
    const gameMessage = await interaction.channel.messages.fetch(state.messageId);
    await gameMessage.edit(await renderMessage(state, `**${user.displayName}** placed **${amount.toLocaleString("en-US")}** on **${formatBetType(betKey, numberValue)}**.`));
    if (state.collector) state.collector.resetTimer();
  } catch (err) {
    logger.error(`[roulette] failed to update game message: ${err}`);
  }
}

async function handleSpin(i, state, client) {
  if (state.bets.length === 0) {
    return i.reply({ content: "Place at least one bet before spinning.", ephemeral: true });
  }
  if (state.status !== "betting") {
    return i.reply({ content: "The wheel is already spinning.", ephemeral: true });
  }

  const lockedBets = state.bets;
  state.bets = [];
  state.status = "spinning";

  await i.deferUpdate();

  const winningNumber = spinWheel();
  const color = getRedBlack(winningNumber);

  const spinEmbed = new EmbedBuilder()
    .setAuthor({ name: `${state.creatorUsername}'s Roulette`, iconURL: state.userAvatars[state.creatorId] })
    .setColor(state.themeColors.embedColor || randomHexColor())
    .setTitle("Spinning the wheel...")
    .setImage("attachment://roulette.png")
    .setTimestamp();

  for (let s = 0; s < 5; s++) {
    const teaser = Math.floor(Math.random() * 37);
    const file = await drawResult(teaser, 0, false, lockedBets, state.userAvatars, state.userColors, state.themeColors);
    await i.editReply({ embeds: [spinEmbed.setTitle("Spinning...")], files: [file], components: buildComponents(state, { disableAll: true }) });
    await wait(500);
  }

  const revealFile = await drawResult(winningNumber, 0, false, lockedBets, state.userAvatars, state.userColors, state.themeColors);
  await i.editReply({ embeds: [spinEmbed.setTitle(`Result: ${winningNumber}...`)], files: [revealFile] });
  await wait(800);

  const results = resolveBets(lockedBets, winningNumber);

  const perUser = {};
  const dbWrites = [];
  let totalWinnings = 0;
  for (let idx = 0; idx < results.length; idx++) {
    const r = results[idx];
    const bet = lockedBets[idx];
    if (!perUser[bet.userId]) perUser[bet.userId] = { username: bet.username, payout: 0, won: 0, lost: 0, winCount: 0, lossCount: 0, biggestWin: 0, biggestLoss: 0 };
    const u = perUser[bet.userId];

    if (r.status === "win") {
      const profit = r.payoutAmount - r.originalAmount;
      u.payout += r.payoutAmount;
      u.won += profit;
      u.winCount += 1;
      if (profit > u.biggestWin) u.biggestWin = profit;
      totalWinnings += r.payoutAmount;
    } else {
      u.lost += r.originalAmount;
      u.lossCount += 1;
      if (r.originalAmount > u.biggestLoss) u.biggestLoss = r.originalAmount;
    }
  }

  for (const [uid, u] of Object.entries(perUser)) {
    if (u.payout > 0) {
      dbWrites.push(withUserLock(uid, () => db.add(`${uid}.balance`, u.payout)));
    }
    const profitChange = u.won - u.lost;
    if (profitChange !== 0) dbWrites.push(db.add(`${uid}.stats.roulette.profit`, profitChange));
    if (u.winCount) dbWrites.push(db.add(`${uid}.stats.roulette.wins`, u.winCount));
    if (u.lossCount) dbWrites.push(db.add(`${uid}.stats.roulette.losses`, u.lossCount));
    if (u.biggestWin > 0) {
      dbWrites.push((async () => {
        const prev = (await db.get(`${uid}.stats.roulette.biggestWin`)) || 0;
        if (u.biggestWin > prev) await db.set(`${uid}.stats.roulette.biggestWin`, u.biggestWin);
      })());
    }
    if (u.biggestLoss > 0) {
      dbWrites.push((async () => {
        const prev = (await db.get(`${uid}.stats.roulette.biggestLoss`)) || 0;
        if (u.biggestLoss > prev) await db.set(`${uid}.stats.roulette.biggestLoss`, u.biggestLoss);
      })());
    }
    if (state.totals[uid]) state.totals[uid].won += u.payout;
  }
  await Promise.all(dbWrites);

  try {
    for (const [uid, u] of Object.entries(perUser)) {
      const userBets = [];
      let wagered = 0;
      for (let idx = 0; idx < results.length; idx++) {
        if (lockedBets[idx].userId !== uid) continue;
        const r = results[idx];
        userBets.push({
          type: lockedBets[idx].type || lockedBets[idx].betType || "unknown",
          number: lockedBets[idx].numberValue ?? null,
          amount: r.originalAmount,
          outcome: r.status,
          payout: r.payoutAmount || 0,
          net: (r.payoutAmount || 0) - r.originalAmount,
        });
        wagered += r.originalAmount;
      }
      recordGameResult({
        guildId: i.guildId,
        channelId: state.channelId,
        userId: uid,
        game: "roulette",
        result: {
          winning_number: winningNumber,
          color,
          bets: userBets,
          total_wagered: wagered,
          total_payout: u.payout,
          net: u.payout - wagered,
        },
      });
    }
  } catch (_) {}

  const finalFile = await drawResult(winningNumber, totalWinnings, true, lockedBets, state.userAvatars, state.userColors, state.themeColors);
  const totalPool = lockedBets.reduce((sum, b) => sum + b.amount, 0);
  const winningColorInt = color === "red"
    ? themeColor(state.themeColors.numberRed || state.themeColors.pocketRed, 0xFF0000)
    : color === "black"
      ? themeColor(state.themeColors.numberBlack || state.themeColors.pocketBlack, 0x000000)
      : themeColor(state.themeColors.zeroGreen || state.themeColors.pocketGreen, 0x00AA00);
  const resultEmbed = new EmbedBuilder()
    .setAuthor({ name: `${state.creatorUsername}'s Roulette`, iconURL: state.userAvatars[state.creatorId] })
    .setColor(winningColorInt)
    .setTitle(`Winning Number: ${winningNumber} (${color})`)
    .setDescription(`Total pool: ${totalPool.toLocaleString("en-US")} ${CURRENCY_NAME}\nTotal winnings paid: ${totalWinnings.toLocaleString("en-US")} ${CURRENCY_NAME}`)
    .setImage("attachment://roulette.png")
    .setTimestamp();

  state.status = "ended";
  client.rouletteGames.delete(state.channelId);
  if (state.collector) {
    try { state.collector.stop("spin"); } catch (_) { /* ignore */ }
  }

  const playAgainRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("roulette_playagain")
      .setLabel("Play Again (same bets)")
      .setEmoji("🔁")
      .setStyle(ButtonStyle.Success),
  );

  let resultMessage;
  try {
    resultMessage = await i.editReply({ embeds: [resultEmbed], files: [finalFile], components: [playAgainRow] });
  } catch (err) {
    logger.error(`[roulette] failed to render post-spin: ${err}`);
  }

  await Promise.all(state.playerOrder.map(uid => sendSessionDM(client, state, uid, lockedBets, winningNumber, color, 0)));

  if (resultMessage) {
    attachPlayAgainCollector(client, resultMessage, state, lockedBets);
  }
}

function attachPlayAgainCollector(client, message, prevState, prevBets) {
  const eligibleUserIds = new Set(prevState.playerOrder);
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60_000,
    filter: i => i.customId === "roulette_playagain",
  });
  collector.on("collect", async (i) => {
    if (!eligibleUserIds.has(i.user.id)) {
      return i.reply({ content: "Only players from the previous game can use Play Again.", ephemeral: true });
    }
    if (client.rouletteGames.has(prevState.channelId)) {
      return i.reply({ content: "A roulette game is already running in this channel — join it directly.", ephemeral: true });
    }
    collector.stop("used");
    try {
      await handlePlayAgain(i, client, prevState, prevBets, message);
    } catch (err) {
      logger.error(`[roulette] play-again error: ${err && err.stack || err}`);
    }
  });
  collector.on("end", async (_collected, reason) => {
    if (reason === "used") return;
    try { await message.edit({ components: [] }); } catch (_) { /* ignore */ }
  });
}

async function handlePlayAgain(buttonInt, client, prevState, prevBets, prevMessage) {
  const channel = buttonInt.channel;
  const channelId = channel.id;
  const user = buttonInt.user;

  try { await prevMessage.edit({ components: [] }); } catch (_) { /* ignore */ }

  await buttonInt.deferReply();

  const themeId = await getEquippedTheme(user.id);
  const themeColors = getThemeColors(themeId, "roulette");
  const avatarUrl = user.displayAvatarURL({ extension: "png", size: 256 });
  const chipColor = await resolveChipColor(buttonInt, user);

  const state = {
    channelId,
    messageId: null,
    creatorId: user.id,
    creatorUsername: user.displayName,
    bets: [],
    userAvatars: { [user.id]: avatarUrl },
    userColors: { [user.id]: chipColor },
    userBetAmounts: { ...(prevState.userBetAmounts || {}) },
    playerOrder: [user.id],
    totals: { [user.id]: { wagered: 0, won: 0, username: user.displayName } },
    themeId,
    themeColors,
    status: "betting",
    collector: null,
  };

  const betsByUser = {};
  for (const b of prevBets) {
    if (!betsByUser[b.userId]) betsByUser[b.userId] = [];
    betsByUser[b.userId].push(b);
  }

  const skipped = [];
  const replaced = [];
  for (const [uid, bets] of Object.entries(betsByUser)) {
    const total = bets.reduce((s, b) => s + b.amount, 0);
    const ok = await withUserLock(uid, async () => {
      const balance = await db.get(`${uid}.balance`) ?? 0;
      if (balance < total) return false;
      await db.sub(`${uid}.balance`, total);
      return true;
    });
    if (!ok) {
      skipped.push(bets[0].username);
      // Drop the cached amount for users we couldn't seat — they can rejoin manually.
      delete state.userBetAmounts[uid];
      continue;
    }
    await db.add(`${uid}.stats.roulette.totalBet`, total);
    await contributeToJackpot(total);

    if (!state.playerOrder.includes(uid)) state.playerOrder.push(uid);
    if (!state.userAvatars[uid]) state.userAvatars[uid] = prevState.userAvatars[uid] ?? avatarUrl;
    if (!state.userColors[uid]) state.userColors[uid] = prevState.userColors[uid] ?? chipColor;
    if (!state.totals[uid]) state.totals[uid] = { wagered: 0, won: 0, username: bets[0].username };
    state.totals[uid].wagered += total;

    for (const b of bets) {
      state.bets.push({ ...b });
    }
    replaced.push(bets[0].username);
  }

  logger.log(`${user.username} (${user.id}) used Play Again in #${channel.name} — replaced ${replaced.length}, skipped ${skipped.length}.`);

  const lines = ["🔁 **Play Again** — bets re-placed from the previous round."];
  if (skipped.length) lines.push(`⚠️ Skipped (insufficient funds): ${skipped.join(", ")}`);

  const message = await buttonInt.editReply(await renderMessage(state, lines.join("\n")));
  state.messageId = message.id;
  client.rouletteGames.set(channelId, state);
  attachCollector(client, channel, message, state);
}

async function endSession(client, channel, message, state, reason, interaction) {
  if (!client.rouletteGames.has(state.channelId)) return;
  if (state.status === "ended") return;
  state.status = "ended";
  client.rouletteGames.delete(state.channelId);
  if (state.collector) {
    try { state.collector.stop(reason); } catch (_) { /* ignore */ }
  }

  const refundsByUser = {};
  for (const bet of state.bets) {
    refundsByUser[bet.userId] = (refundsByUser[bet.userId] || 0) + bet.amount;
  }
  const standingBets = state.bets.slice();
  state.bets = [];

  const refundWrites = [];
  for (const [uid, amount] of Object.entries(refundsByUser)) {
    if (amount > 0) refundWrites.push(withUserLock(uid, () => db.add(`${uid}.balance`, amount)));
  }
  await Promise.all(refundWrites);

  const totalRefund = Object.values(refundsByUser).reduce((s, v) => s + v, 0);
  const reasonText = reason === "idle"
    ? `Game ended due to inactivity — refunded **${totalRefund.toLocaleString("en-US")}** ${CURRENCY_NAME} across standing bets.`
    : `Game cancelled — refunded **${totalRefund.toLocaleString("en-US")}** ${CURRENCY_NAME} across standing bets.`;

  let attachment;
  try {
    attachment = await drawRouletteTable(standingBets, state.userAvatars, state.userColors, state.themeColors);
  } catch (err) {
    logger.warn(`[roulette] failed to render final table: ${err}`);
  }

  const embed = new EmbedBuilder()
    .setAuthor({ name: `${state.creatorUsername}'s Roulette`, iconURL: state.userAvatars[state.creatorId] })
    .setColor(state.themeColors.embedColor || 0x888888)
    .setDescription(reasonText)
    .setFooter({ text: `Players: ${state.playerOrder.length}` })
    .setTimestamp();
  if (attachment) embed.setImage("attachment://roulette.png");

  try {
    if (interaction) {
      await interaction.deferUpdate().catch(() => {});
      await interaction.editReply({ embeds: [embed], files: attachment ? [attachment] : [], components: [] });
    } else if (message) {
      await message.edit({ embeds: [embed], files: attachment ? [attachment] : [], components: [] });
    }
  } catch (err) {
    logger.warn(`[roulette] failed to finalize game message: ${err}`);
  }

  await Promise.all(state.playerOrder.map(uid => sendSessionDM(client, state, uid, [], null, null, refundsByUser[uid] || 0)));
}

async function sendSessionDM(client, state, userId, resolvedBets, winningNumber, color, refunded) {
  const totals = state.totals[userId] || { wagered: 0, won: 0 };
  const net = totals.won - totals.wagered + refunded;
  try {
    const dmUser = await client.users.fetch(userId);
    const balance = await db.get(`${userId}.balance`) ?? 0;
    const userBets = resolvedBets.filter(b => b.userId === userId);
    const betLines = userBets.length
      ? userBets.map(b => `• ${b.amount.toLocaleString("en-US")} ${CURRENCY_NAME} on ${formatBetType(b.type, b.numberValue)}`).join("\n")
      : null;

    const lines = [];
    if (winningNumber !== null && color !== null) {
      lines.push(`Winning Number: **${winningNumber}** (${color})`);
      lines.push("");
    }
    if (betLines) {
      lines.push(`**Your bet${userBets.length > 1 ? "s" : ""}:**`);
      lines.push(betLines);
      lines.push("");
    }
    lines.push(`**Total wagered:** ${totals.wagered.toLocaleString("en-US")} ${CURRENCY_NAME}`);
    lines.push(`**Total won:** ${totals.won.toLocaleString("en-US")} ${CURRENCY_NAME}`);
    if (refunded > 0) lines.push(`**Refunded (standing bets):** ${refunded.toLocaleString("en-US")} ${CURRENCY_NAME}`);
    lines.push(`**Net:** ${net >= 0 ? "+" : ""}${net.toLocaleString("en-US")} ${CURRENCY_NAME}`);
    lines.push("");
    lines.push(`New balance: **${balance.toLocaleString("en-US")}** ${CURRENCY_NAME}.`);

    const dmColor = net > 0
      ? themeColor(state.themeColors.textWin, 0x00AA00)
      : net < 0
        ? themeColor(state.themeColors.textLoss, 0xFF0000)
        : themeColor(state.themeColors.embedColor, 0x888888);
    const embed = new EmbedBuilder()
      .setTitle(net > 0 ? "Roulette Results — You Won!" : (net < 0 ? "Roulette Results — You Lost" : "Roulette Results"))
      .setColor(dmColor)
      .setDescription(lines.join("\n"))
      .setTimestamp();
    await sendDM(dmUser, { embeds: [embed] });
  } catch (err) {
    logger.warn(`[roulette] could not DM ${userId}: ${err.message || err}`);
  }
}
