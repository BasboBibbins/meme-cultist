const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require("discord.js");
const { addNewDBUser, db } = require("../../database");
const { CURRENCY_NAME, RACE_MIN_BET, RACE_MAX_BET, RACE_BETTING_TIME, RACE_HOUSE_EDGE, RACE_ANIMATION_TICKS, RACE_TICK_INTERVAL } = require("../../config.js");
const { openBetModal } = require("../../utils/betModal");
const { parseBet } = require("../../utils/betparse");
const { withUserLock } = require("../../utils/userlock");
const { applyRaceAggregates } = require("../../utils/guildStats");
const { generateHorses, determineTopThree, calculatePayout, buildBettingDescription, buildRaceDescription, buildRaceTitle, advanceRace, generateRaceCommentary, summarizeBettors, buildResultsSection, fitDescription } = require("../../utils/race");
const logger = require("../../utils/logger");
const { sendDM } = require("../../utils/dm");
const { getEquippedTheme } = require("../../themes/manager");
const { getThemeColors, toEmbedColor } = require("../../themes/resolver");
const { buildErrorEmbed } = require("../../utils/embeds");
const wait = require("node:timers/promises").setTimeout;
const { recordGameResult } = require("../../utils/gameResults");
const PACKAGE_VERSION = require("../../package.json").version;

const HOUSE_EDGE = RACE_HOUSE_EDGE ?? 0.10;
const BETTING_TIME = RACE_BETTING_TIME ?? 20000;
const ANIMATION_TICKS = RACE_ANIMATION_TICKS ?? 10;
const TICK_INTERVAL = RACE_TICK_INTERVAL ?? 1500;
const BET_TYPES = new Set(["win", "place", "show"]);
const COMMENTARY_TIMEOUT = 10000;
// Descriptions carry their meaning, which "win / place / show" alone never did
// for anyone who hasn't been to a racetrack.
const BET_TYPE_OPTIONS = [
  { label: "Win", value: "win", description: "Has to finish 1st. Full odds." },
  { label: "Place", value: "place", description: "1st or 2nd. Reduced payout." },
  { label: "Show", value: "show", description: "Top 3. Smallest payout." },
];

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("race")
    .setDescription(`Horse racing betting game for ${CURRENCY_NAME}.`)
    .addSubcommand(subcommand =>
      subcommand
        .setName("start")
        .setDescription("Start a new horse race."))
    .addSubcommand(subcommand =>
      subcommand
        .setName("bet")
        .setDescription("Place a bet on the current horse race (power-user fast-path).")
        .addIntegerOption(option =>
          option.setName("horse")
            .setDescription("The horse number to bet on (1-8)")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(8))
        .addStringOption(option =>
          option.setName("amount")
            .setDescription(`The amount of ${CURRENCY_NAME} to bet.`)
            .setRequired(true))
        .addStringOption(option =>
          option.setName("type")
            .setDescription("Bet type: Win (1st), Place (1st-2nd), Show (1st-3rd)")
            .setRequired(false)
            .addChoices(
              { name: "Win (must finish 1st)", value: "win" },
              { name: "Place (must finish 1st or 2nd)", value: "place" },
              { name: "Show (must finish 1st, 2nd, or 3rd)", value: "show" }
            ))),

  async execute(interaction) {
    const client = interaction.client;
    const user = interaction.user;
    const subcommand = interaction.options.getSubcommand();

    if (!client.raceGames) {
      client.raceGames = new Map();
    }

    if (subcommand === "bet") {
      await handleSlashBet(interaction, client, user);
    } else {
      await handleStartRace(interaction, client, user);
    }
  },
};


// Four roles, resolved once per race so all three acts share one identity.
async function resolveRaceColors(userId) {
  const colors = getThemeColors(await getEquippedTheme(userId), "race");
  return {
    identity: toEmbedColor(colors.embedColor),
    win: toEmbedColor(colors.textWin, 0x00AE86),
    loss: toEmbedColor(colors.textLoss, 0xFF0000),
    interrupted: toEmbedColor(colors.gold, 0xFFD700),
  };
}

// Carries the panel's author and footer so it is not read as a stray message.
function buildStoppedEmbed(client, game, description) {
  return new EmbedBuilder()
    .setAuthor({ name: "🏇 Horse Race", iconURL: client.user.displayAvatarURL({ dynamic: true }) })
    .setTitle("Race Cancelled")
    .setDescription(description)
    .setColor(game.colors.interrupted)
    .setFooter({ text: `${client.user.username} | Version ${PACKAGE_VERSION}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
    .setTimestamp();
}

function buildLobbyEmbed(client, game) {
  return new EmbedBuilder()
    .setAuthor({ name: "🏇 Horse Race", iconURL: client.user.displayAvatarURL({ dynamic: true }) })
    .setTitle("🏇 Place Your Bets! 🏇")
    .setDescription(buildBettingDescription(game.horses, game.bets, game.endTime))
    .setColor(game.colors.identity)
    .setFooter({ text: "Click a horse to bet", iconURL: client.user.displayAvatarURL({ dynamic: true }) })
    .setTimestamp();
}

function startRejectionMessage(game) {
  if (game.phase === "starting") return "A race is starting in this channel. Give the panel a moment to appear.";
  if (game.phase === "betting") return "A race is already accepting bets in this channel. Click a horse on the existing panel to wager.";
  return "A race is already in progress. Please wait for it to finish.";
}

function formatBetType(type) {
  const t = (type || "win").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Two horses per row rather than four: the label carries a number, a name and
// the odds, which the mobile client truncates to unreadable stubs at quarter
// width. Eight horses fill four rows, and the controls take the fifth — the
// message is at Discord's five-row ceiling, so another row cannot be added.
const HORSES_PER_ROW = 2;

function buildComponents(horses, disabled = false) {
  const sorted = [...horses].sort((a, b) => a.number - b.number);
  const horseRows = [];
  for (let i = 0; i < sorted.length; i++) {
    const h = sorted[i];
    const btn = new ButtonBuilder()
      .setCustomId(`race_bet_${h.number}`)
      .setLabel(`${h.number}: ${h.name} [${h.displayOdds}x]`)
      .setEmoji(h.emoji)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled);
    if (i % HORSES_PER_ROW === 0) horseRows.push(new ActionRowBuilder());
    horseRows[horseRows.length - 1].addComponents(btn);
  }
  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("race_start_now")
      .setLabel("Start Now")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("race_clear_bets")
      .setLabel("Clear My Bets")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("race_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
  return [...horseRows, controlRow];
}

async function handleStartRace(interaction, client, user) {
  const channelId = interaction.channelId;
  const channel = interaction.channel;

  const existingGame = client.raceGames.get(channelId);
  if (existingGame) {
    return interaction.reply({ embeds: [buildErrorEmbed(user, client,startRejectionMessage(existingGame))], flags: MessageFlags.Ephemeral });
  }

  // Claimed before the first await, or a concurrent /race start clears the guard above and orphans one of the two games.
  const reservation = { phase: "starting", creatorId: user.id };
  client.raceGames.set(channelId, reservation);

  let message;
  let commentaryPromise = null;
  let game;

  try {
    await interaction.deferReply();

    const horses = generateHorses();
    const topThree = determineTopThree(horses);

    logger.log(`${user.username} (${user.id}) started a horse race. Winner: Horse ${topThree.first.number} (${topThree.first.name}), 2nd: ${topThree.second.number}, 3rd: ${topThree.third.number}`);

    if (OPENAI_API_KEY) {
      commentaryPromise = generateRaceCommentary();
    }

    const endTime = Date.now() + BETTING_TIME;
    const betsDescription = buildBettingDescription(horses, [], endTime);
    const colors = await resolveRaceColors(user.id);

    const embed = new EmbedBuilder()
      .setAuthor({ name: `🏇 Horse Race Started by ${user.displayName}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
      .setTitle("🏇 Place Your Bets! 🏇")
      .setDescription(betsDescription)
      .setColor(colors.identity)
      .setFooter({ text: "Click a horse to bet", iconURL: client.user.displayAvatarURL({ dynamic: true }) })
      .setTimestamp();

    message = await interaction.editReply({ embeds: [embed], components: buildComponents(horses) });

    game = {
      channelId,
      guildId: channel.guild?.id ?? interaction.guildId,
      messageId: message.id,
      creatorId: user.id,
      creatorUsername: user.displayName,
      colors,
      horses,
      topThree: {
        firstIndex: topThree.firstIndex,
        secondIndex: topThree.secondIndex,
        thirdIndex: topThree.thirdIndex,
        finishOrder: topThree.finishOrder.slice(),
      },
      bets: [],
      phase: "betting",
      endTime,
      collector: null,
      commentary: null,
    };

    client.raceGames.set(channelId, game);
  } catch (err) {
    if (client.raceGames.get(channelId) === reservation) client.raceGames.delete(channelId);
    logger.error(`[race] failed to start race in ${channelId}: ${err && err.stack || err}`);
    await interaction.followUp({ embeds: [buildErrorEmbed(user, client,"Could not start the race. Try again.")], flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: BETTING_TIME,
  });
  game.collector = collector;

  collector.on("collect", async (i) => {
    try {
      // A panel that no longer owns the channel slot belongs to a superseded race, so it must never mutate the live one.
      if (client.raceGames.get(channelId) !== game) {
        await i.reply({ embeds: [buildErrorEmbed(i.user, i.client,"This race panel is no longer active.")], flags: MessageFlags.Ephemeral }).catch(() => {});
        collector.stop("superseded");
        return;
      }
      if (i.customId.startsWith("race_bet_")) {
        const horseNumber = parseInt(i.customId.replace("race_bet_", ""), 10);
        return handleBetButton(i, client, game, horseNumber);
      }
      if (i.customId === "race_start_now") {
        if (i.user.id !== game.creatorId) {
          return i.reply({ embeds: [buildErrorEmbed(i.user, i.client,`Only **${game.creatorUsername}** can start this race.`)], flags: MessageFlags.Ephemeral });
        }
        await i.deferUpdate().catch(() => {});
        game.collector.stop("start");
        return;
      }
      if (i.customId === "race_clear_bets") {
        return handleClearBets(i, client, game);
      }
      if (i.customId === "race_cancel") {
        if (i.user.id !== game.creatorId) {
          return i.reply({ embeds: [buildErrorEmbed(i.user, i.client,`Only **${game.creatorUsername}** can cancel this race.`)], flags: MessageFlags.Ephemeral });
        }

        const refundsByUser = {};
        for (const b of game.bets) {
          refundsByUser[b.userId] = (refundsByUser[b.userId] || 0) + b.amount;
        }
        for (const [uid, amount] of Object.entries(refundsByUser)) {
          await withUserLock(uid, () => db.add(`${uid}.balance`, amount));
          await db.sub(`${uid}.stats.race.totalBet`, amount);
        }

        const refunded = Object.values(refundsByUser).reduce((sum, amount) => sum + amount, 0);
        await i.update({
          embeds: [buildStoppedEmbed(client, game, refunded > 0
            ? `Cancelled by **${game.creatorUsername}**. Refunded **${refunded.toLocaleString("en-US")}** ${CURRENCY_NAME} across ${game.bets.length} bet${game.bets.length === 1 ? "" : "s"}.`
            : `Cancelled by **${game.creatorUsername}**. No bets to refund.`)],
          components: [],
        });
        if (client.raceGames.get(channelId) === game) client.raceGames.delete(channelId);
        game.collector.stop("cancel");
        return;
      }
    } catch (err) {
      logger.error(`[race] handler error: ${err && err.stack || err}`);
      try {
        if (!i.replied && !i.deferred) await i.reply({ content: "Something went wrong handling that action.", flags: MessageFlags.Ephemeral });
      } catch (_) { /* ignore */ }
    }
  });

  collector.on("end", async (_collected, reason) => {
    if (client.raceGames.get(channelId) !== game || game.phase !== "betting") return;

    if (reason === "time" || reason === "start") {
      await resolveRace(client, channel, message, game);
    }
  });

  // Deliberately not awaited: the buttons are already live, and awaiting here
  // left every click unhandled until the model replied.
  if (commentaryPromise) loadCommentary(game, commentaryPromise);
}

async function loadCommentary(game, commentaryPromise) {
  let timer;
  try {
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), COMMENTARY_TIMEOUT); });
    game.commentary = await Promise.race([commentaryPromise, timeout]);
    if (game.commentary) logger.debug(`Race commentary generated: ${game.commentary.length} lines`);
  } catch (e) {
    logger.warn(`Failed to generate race commentary: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function handleBetButton(buttonInt, client, game, horseNumber) {
  const user = buttonInt.user;

  if (game.phase !== "betting") {
    return buttonInt.reply({ embeds: [buildErrorEmbed(user, client,"Betting is closed for this race.")], flags: MessageFlags.Ephemeral });
  }

  const horseIndex = game.horses.findIndex(h => h.number === horseNumber);
  if (horseIndex === -1) {
    return buttonInt.reply({ embeds: [buildErrorEmbed(user, client,"Unknown horse.")], flags: MessageFlags.Ephemeral });
  }
  const horse = game.horses[horseIndex];

  // Serial reads here burn the 3s the modal has to appear in.
  const [dbUser, cachedExpression, cachedBetTypeRaw] = await Promise.all([
    db.get(user.id),
    db.get(`${user.id}.race.lastBet`),
    db.get(`${user.id}.race.lastBetType`),
  ]);
  if (!dbUser) {
    logger.warn(`No database entry for user ${user.username} (${user.id}), creating one...`);
    await addNewDBUser(user);
  }
  const cachedBetType = BET_TYPES.has((cachedBetTypeRaw || "").toLowerCase())
    ? cachedBetTypeRaw.toLowerCase()
    : "win";

  const modalOpts = {
    title: `Bet on Horse ${horse.number}`,
    min: RACE_MIN_BET,
    extras: [{
      type: "radio",
      customId: "betType",
      label: "Bet Type",
      description: "Easier finishes pay less.",
      options: BET_TYPE_OPTIONS.map(option => ({ ...option, default: option.value === cachedBetType })),
    }],
  };
  if (RACE_MAX_BET) modalOpts.max = RACE_MAX_BET;
  if (typeof cachedExpression === "string" && cachedExpression.length > 0) {
    modalOpts.defaultAmount = cachedExpression;
  }

  const result = await openBetModal(buttonInt, modalOpts);
  if (!result) return;
  const { amount, expression, submit } = result;

  // The radio group constrains this to the three known values, so this guard is
  // defence in depth — bet type changes the payout, so it is never coerced.
  const betTypeRaw = (submit.fields.getRadioGroup("betType") || "").toLowerCase();
  if (!BET_TYPES.has(betTypeRaw)) {
    return submit.reply({ embeds: [buildErrorEmbed(submit.user, submit.client,"Pick a bet type — win, place, or show.")], flags: MessageFlags.Ephemeral });
  }

  const current = client.raceGames.get(game.channelId);
  if (current !== game || current.phase !== "betting") {
    return submit.reply({ embeds: [buildErrorEmbed(submit.user, submit.client,"Betting is no longer open for this race.")], flags: MessageFlags.Ephemeral });
  }

  const debited = await withUserLock(user.id, async () => {
    const balance = await db.get(`${user.id}.balance`) ?? 0;
    if (balance < amount) return false;
    await db.sub(`${user.id}.balance`, amount);
    return true;
  });
  if (!debited) {
    return submit.reply({ embeds: [buildErrorEmbed(submit.user, submit.client,"Insufficient funds in wallet!")], flags: MessageFlags.Ephemeral });
  }
  await db.add(`${user.id}.stats.race.totalBet`, amount);
  await db.set(`${user.id}.race.lastBet`, expression);
  await db.set(`${user.id}.race.lastBetType`, betTypeRaw);

  const betObj = {
    userId: user.id,
    username: user.displayName,
    horseIndex,
    amount,
    odds: horse.displayOdds,
    betType: betTypeRaw,
  };
  current.bets.push(betObj);

  current.endTime = Date.now() + BETTING_TIME;
  if (current.collector) current.collector.resetTimer();

  logger.log(`${user.username} (${user.id}) bet ${amount} ${CURRENCY_NAME} on Horse ${horseNumber} (${horse.name}) - ${betTypeRaw}`);

  try {
    const gameMessage = await buttonInt.channel.messages.fetch(current.messageId);
    await gameMessage.edit({ embeds: [buildLobbyEmbed(client, current)] });
  } catch (e) {
    logger.error(`Error updating race message: ${e.message}`);
  }

  const confirmEmbed = new EmbedBuilder()
    .setAuthor({ name: "Bet Placed!", iconURL: user.displayAvatarURL({ dynamic: true }) })
    .setDescription([
      `You bet **${amount.toLocaleString("en-US")}** ${CURRENCY_NAME} on:`,
      `**Horse ${horse.number}: ${horse.name}** ${horse.emoji}`,
      `**Odds:** ${horse.displayOdds}x`,
      `**Bet Type:** ${formatBetType(betTypeRaw)}`,
      `**Potential win:** ${calculatePayout(amount, horse.displayOdds, HOUSE_EDGE, betTypeRaw).toLocaleString("en-US")} ${CURRENCY_NAME}`,
    ].join("\n"))
    .setColor(current.colors.identity)
    .setTimestamp();

  await submit.reply({ embeds: [confirmEmbed], flags: MessageFlags.Ephemeral });
}

// Power-user fast-path that mirrors the legacy `/race bet` slash subcommand
// but plugs into the new shared game state: multi-bet allowed, debit goes
// through withUserLock, panel message is re-rendered, and the user's bet
// amount + bet type are cached so the next button-driven modal pre-fills.
async function handleSlashBet(interaction, client, user) {
  const channelId = interaction.channelId;
  const horseNumber = interaction.options.getInteger("horse");
  const betAmountStr = interaction.options.getString("amount");
  const betTypeRaw = (interaction.options.getString("type") || "win").toLowerCase();

  // Validation, parseBet and the debit exceed the 3s ack window.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const game = client.raceGames.get(channelId);
  if (!game) {
    return interaction.editReply({
      embeds: [buildErrorEmbed(user, client,"No active race in this channel. Use `/race start` to begin a new race.")],
    });
  }
  if (game.phase === "starting") {
    return interaction.editReply({
      embeds: [buildErrorEmbed(user, client,"A race is starting in this channel. Give the panel a moment to appear.")],
    });
  }
  if (game.phase !== "betting") {
    return interaction.editReply({
      embeds: [buildErrorEmbed(user, client,"Betting is closed for this race. Please wait for it to finish.")],
    });
  }
  if (!BET_TYPES.has(betTypeRaw)) {
    return interaction.editReply({
      embeds: [buildErrorEmbed(user, client,"Bet type must be `win`, `place`, or `show`.")],
    });
  }

  const dbUser = await db.get(user.id);
  if (!dbUser) {
    logger.warn(`No database entry for user ${user.username} (${user.id}), creating one...`);
    await addNewDBUser(user);
  }

  const horseIndex = game.horses.findIndex(h => h.number === horseNumber);
  if (horseIndex === -1) {
    return interaction.editReply({ embeds: [buildErrorEmbed(user, client,"Horse number must be between 1 and 8!")] });
  }
  const horse = game.horses[horseIndex];

  const expression = betAmountStr.trim();
  const amount = Number(await parseBet(expression, user.id));
  if (isNaN(amount) || amount % 1 !== 0) {
    return interaction.editReply({ embeds: [buildErrorEmbed(user, client,`You must bet a valid whole number of ${CURRENCY_NAME}!`)] });
  }
  if (amount <= 0) {
    return interaction.editReply({ embeds: [buildErrorEmbed(user, client,"Bet must be greater than zero.")] });
  }
  if (RACE_MIN_BET && amount < RACE_MIN_BET) {
    return interaction.editReply({ embeds: [buildErrorEmbed(user, client,`Minimum bet is ${RACE_MIN_BET.toLocaleString("en-US")} ${CURRENCY_NAME}!`)] });
  }
  if (RACE_MAX_BET && amount > RACE_MAX_BET) {
    return interaction.editReply({ embeds: [buildErrorEmbed(user, client,`Maximum bet is ${RACE_MAX_BET.toLocaleString("en-US")} ${CURRENCY_NAME}!`)] });
  }

  const debited = await withUserLock(user.id, async () => {
    const balance = await db.get(`${user.id}.balance`) ?? 0;
    if (balance < amount) return false;
    await db.sub(`${user.id}.balance`, amount);
    return true;
  });
  if (!debited) {
    const currentBalance = await db.get(`${user.id}.balance`) ?? 0;
    return interaction.editReply({
      embeds: [buildErrorEmbed(user, client,`Insufficient funds! You have **${currentBalance.toLocaleString("en-US")}** ${CURRENCY_NAME}.`)],
    });
  }
  await db.add(`${user.id}.stats.race.totalBet`, amount);
  // Cache the raw expression + bet type so future button-driven modals
  // pre-fill, keeping the slash and button paths in sync.
  await db.set(`${user.id}.race.lastBet`, expression);
  await db.set(`${user.id}.race.lastBetType`, betTypeRaw);

  const current = client.raceGames.get(channelId);
  if (current !== game || current.phase !== "betting") {
    // Race ended between validation and debit — refund and bail.
    await withUserLock(user.id, () => db.add(`${user.id}.balance`, amount));
    await db.sub(`${user.id}.stats.race.totalBet`, amount);
    return interaction.editReply({
      embeds: [buildErrorEmbed(user, client,"Betting closed while your bet was being placed — refunded.")],
    });
  }

  current.bets.push({
    userId: user.id,
    username: user.displayName,
    horseIndex,
    amount,
    odds: horse.displayOdds,
    betType: betTypeRaw,
  });
  current.endTime = Date.now() + BETTING_TIME;
  if (current.collector) current.collector.resetTimer();

  logger.log(`${user.username} (${user.id}) bet ${amount} ${CURRENCY_NAME} on Horse ${horseNumber} (${horse.name}) - ${betTypeRaw} [slash]`);

  try {
    const gameMessage = await interaction.channel.messages.fetch(current.messageId);
    await gameMessage.edit({ embeds: [buildLobbyEmbed(client, current)] });
  } catch (e) {
    logger.error(`Error updating race message: ${e.message}`);
  }

  const confirmEmbed = new EmbedBuilder()
    .setAuthor({ name: "Bet Placed!", iconURL: user.displayAvatarURL({ dynamic: true }) })
    .setDescription([
      `You bet **${amount.toLocaleString("en-US")}** ${CURRENCY_NAME} on:`,
      `**Horse ${horse.number}: ${horse.name}** ${horse.emoji}`,
      `**Odds:** ${horse.displayOdds}x`,
      `**Bet Type:** ${formatBetType(betTypeRaw)}`,
      `**Potential win:** ${calculatePayout(amount, horse.displayOdds, HOUSE_EDGE, betTypeRaw).toLocaleString("en-US")} ${CURRENCY_NAME}`,
    ].join("\n"))
    .setColor(current.colors.identity)
    .setTimestamp();

  await interaction.editReply({ embeds: [confirmEmbed] });
}

async function handleClearBets(buttonInt, client, game) {
  const user = buttonInt.user;

  if (game.phase !== "betting") {
    return buttonInt.deferUpdate().catch(() => {});
  }

  const userBets = game.bets.filter(b => b.userId === user.id);
  if (userBets.length === 0) {
    // Silent ignore per spec — no ephemeral, just ack so Discord doesn't show "interaction failed".
    return buttonInt.deferUpdate().catch(() => {});
  }

  const totalStaked = userBets.reduce((sum, b) => sum + b.amount, 0);
  const modalId = `race_clear_modal_${buttonInt.id}`;
  const confirmInput = new TextInputBuilder()
    .setCustomId("confirm")
    .setLabel("Type CONFIRM to clear all your bets")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("CONFIRM")
    .setRequired(true)
    .setMinLength(7)
    .setMaxLength(7);
  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle(`Clear ${userBets.length} bet${userBets.length === 1 ? "" : "s"} (${totalStaked.toLocaleString("en-US")} ${CURRENCY_NAME})?`)
    .addComponents(new ActionRowBuilder().addComponents(confirmInput));

  await buttonInt.showModal(modal);

  let submit;
  try {
    submit = await buttonInt.awaitModalSubmit({
      filter: m => m.customId === modalId && m.user.id === user.id,
      time: 60000,
    });
  } catch {
    return;
  }

  const typed = submit.fields.getTextInputValue("confirm").trim().toUpperCase();
  if (typed !== "CONFIRM") {
    return submit.reply({ embeds: [buildErrorEmbed(submit.user, submit.client,"You must type `CONFIRM` exactly to clear your bets. No bets were removed.")], flags: MessageFlags.Ephemeral });
  }

  const current = client.raceGames.get(game.channelId);
  if (current !== game || current.phase !== "betting") {
    return submit.reply({ embeds: [buildErrorEmbed(submit.user, submit.client,"Betting is no longer open — your bets are already locked in.")], flags: MessageFlags.Ephemeral });
  }

  const standingBets = current.bets.filter(b => b.userId === user.id);
  if (standingBets.length === 0) {
    return submit.reply({ embeds: [buildErrorEmbed(submit.user, submit.client,"You no longer have any standing bets to clear.")], flags: MessageFlags.Ephemeral });
  }

  const refund = standingBets.reduce((sum, b) => sum + b.amount, 0);
  current.bets = current.bets.filter(b => b.userId !== user.id);

  await withUserLock(user.id, () => db.add(`${user.id}.balance`, refund));
  await db.sub(`${user.id}.stats.race.totalBet`, refund);

  logger.log(`${user.username} (${user.id}) cleared ${standingBets.length} race bet(s) in ${current.channelId}, refunded ${refund}.`);

  try {
    const gameMessage = await submit.channel.messages.fetch(current.messageId);
    await gameMessage.edit({ embeds: [buildLobbyEmbed(client, current)] });
  } catch (e) {
    logger.error(`Error updating race message after clear: ${e.message}`);
  }

  const confirmEmbed = new EmbedBuilder()
    .setAuthor({ name: "Bets Cleared", iconURL: user.displayAvatarURL({ dynamic: true }) })
    .setDescription(`Cleared **${standingBets.length}** bet${standingBets.length === 1 ? "" : "s"}. Refunded **${refund.toLocaleString("en-US")}** ${CURRENCY_NAME} to your wallet.`)
    .setColor(current.colors.interrupted)
    .setTimestamp();
  await submit.reply({ embeds: [confirmEmbed], flags: MessageFlags.Ephemeral });
}

// repost message so it doesn't get lost in spam
async function repostRaceMessage(channel, previous, payload) {
  try {
    const posted = await channel.send(payload);
    if (previous) await previous.delete().catch(() => {});
    return posted;
  } catch (err) {
    logger.warn(`[race] repost failed, falling back to editing in place: ${err.message}`);
    if (previous) await previous.edit(payload).catch(() => {});
    return previous;
  }
}

// Releases the channel slot whatever happens below. A throw mid-resolve used to wedge the channel until restart.
async function resolveRace(client, channel, message, game) {
  try {
    await runRace(client, channel, message, game);
  } catch (err) {
    logger.error(`[race] resolve failed in ${game.channelId}: ${err && err.stack || err}`);
  } finally {
    if (client.raceGames.get(game.channelId) === game) client.raceGames.delete(game.channelId);
  }
}

async function runRace(client, channel, message, game) {
  game.phase = "racing";

  await message.edit({ components: [] }).catch(() => {});

  const horses = game.horses;
  const positions = new Array(8).fill(0);
  let finishOrder = [];

  if (game.bets.length === 0) {
    const embed = buildStoppedEmbed(client, game, "Nobody put anything down, so the horses went home. Start another with `/race start`.");
    await message.edit({ embeds: [embed], components: [] }).catch(() => {});
    return;
  }

  const embed = new EmbedBuilder()
    .setAuthor({ name: "Horse Race", iconURL: client.user.displayAvatarURL({ dynamic: true }) })
    .setColor(game.colors.identity)
    .setTimestamp();

  // The lobby message is replaced on the first tick rather than edited, so the
  // race runs where people are actually looking.
  let raceMessage = null;

  for (let tick = 1; tick <= ANIMATION_TICKS; tick++) {
    const result = advanceRace(horses, positions, game.topThree, tick, ANIMATION_TICKS);

    for (const idx of result.newFinishers) {
      if (!finishOrder.includes(idx)) {
        finishOrder.push(idx);
      }
    }

    const description = buildRaceDescription(horses, positions, tick, ANIMATION_TICKS, null, finishOrder, game.topThree);
    const commentary = buildRaceTitle(game.commentary, tick, ANIMATION_TICKS, horses, positions, null, finishOrder);
    embed.setTitle(commentary);
    embed.setDescription(`\`\`\`\n${description}\n\`\`\``);

    if (tick === 1) {
      raceMessage = await repostRaceMessage(channel, message, { embeds: [embed] });
      game.messageId = raceMessage?.id ?? game.messageId;
    } else {
      await raceMessage?.edit({ embeds: [embed] }).catch(() => {});
    }
    await wait(TICK_INTERVAL);
  }

  finishOrder = game.topThree.finishOrder.slice();

  for (let i = 0; i < positions.length; i++) {
    positions[i] = 100;
  }

  const winner = horses[game.topThree.firstIndex];
  const secondPlace = horses[game.topThree.secondIndex];
  const thirdPlace = horses[game.topThree.thirdIndex];
  const finalDescription = buildRaceDescription(horses, positions, ANIMATION_TICKS, ANIMATION_TICKS, game.topThree.firstIndex, finishOrder);
  const finishCommentary = buildRaceTitle(game.commentary, ANIMATION_TICKS, ANIMATION_TICKS, horses, positions, game.topThree.firstIndex, finishOrder);

  const results = [];
  // Per-horse-name accumulator for the guild aggregate write at the end of
  // the resolve. Bundling avoids N writes per race.
  const horseDeltas = {};
  let topSingleBet = null;
  let topSinglePayout = null;

  for (const bet of game.bets) {
    const horsePosition = finishOrder.indexOf(bet.horseIndex);
    const betType = bet.betType || "win";
    const horseSnapshot = {
      emoji: horses[bet.horseIndex].emoji,
      name: horses[bet.horseIndex].name,
      displayOdds: horses[bet.horseIndex].displayOdds,
    };
    let won = false;

    if (betType === "win") {
      won = horsePosition === 0;
    } else if (betType === "place") {
      won = horsePosition === 0 || horsePosition === 1;
    } else if (betType === "show") {
      won = horsePosition === 0 || horsePosition === 1 || horsePosition === 2;
    }

    let winnings = 0;

    if (won) {
      winnings = calculatePayout(bet.amount, bet.odds, HOUSE_EDGE, betType);
      await withUserLock(bet.userId, () => db.add(`${bet.userId}.balance`, winnings));
      await db.add(`${bet.userId}.stats.race.wins`, 1);

      if (betType === "place") {
        await db.add(`${bet.userId}.stats.race.placeWins`, 1);
      } else if (betType === "show") {
        await db.add(`${bet.userId}.stats.race.showWins`, 1);
      }

      const biggestWin = await db.get(`${bet.userId}.stats.race.biggestWin`) || 0;
      if (winnings > biggestWin) {
        await db.set(`${bet.userId}.stats.race.biggestWin`, winnings);
        await db.set(`${bet.userId}.stats.race.biggestWinHorse`, horseSnapshot);
      }
    } else {
      await db.add(`${bet.userId}.stats.race.losses`, 1);

      const biggestLoss = await db.get(`${bet.userId}.stats.race.biggestLoss`) || 0;
      if (bet.amount > biggestLoss) {
        await db.set(`${bet.userId}.stats.race.biggestLoss`, bet.amount);
        await db.set(`${bet.userId}.stats.race.biggestLossHorse`, horseSnapshot);
      }
    }

    // Guild-wide aggregate accumulators
    const horseName = horseSnapshot.name;
    if (!horseDeltas[horseName]) {
      horseDeltas[horseName] = {
        emoji: horseSnapshot.emoji,
        displayOdds: horseSnapshot.displayOdds,
        bets: 0,
        wagered: 0,
        payouts: 0,
        bettorIds: new Set(),
      };
    }
    horseDeltas[horseName].bets += 1;
    horseDeltas[horseName].wagered += bet.amount;
    horseDeltas[horseName].payouts += winnings;
    horseDeltas[horseName].bettorIds.add(bet.userId);

    if (!topSingleBet || bet.amount > topSingleBet.amount) {
      topSingleBet = {
        userId: bet.userId,
        username: bet.username,
        amount: bet.amount,
        horse: horseSnapshot,
        betType,
        timestamp: Date.now(),
      };
    }
    if (won && (!topSinglePayout || winnings > topSinglePayout.amount)) {
      topSinglePayout = {
        userId: bet.userId,
        username: bet.username,
        amount: winnings,
        horse: horseSnapshot,
        betType,
        timestamp: Date.now(),
      };
    }

    results.push({ ...bet, won, winnings, horsePosition });
  }

  try {
    const podium = game.topThree.finishOrder.slice(0, 3).map((idx, place) => ({
      place: place + 1,
      number: horses[idx].number,
      name: horses[idx].name,
      emoji: horses[idx].emoji,
    }));

    const byUser = {};
    for (const r of results) {
      if (!byUser[r.userId]) byUser[r.userId] = [];
      byUser[r.userId].push({
        horse: horses[r.horseIndex].name,
        horse_number: horses[r.horseIndex].number,
        bet_type: r.betType || "win",
        amount: r.amount,
        outcome: r.won ? "win" : "loss",
        payout: r.winnings,
        net: r.won ? r.winnings - r.amount : -r.amount,
      });
    }
    for (const [uid, userBets] of Object.entries(byUser)) {
      const net = userBets.reduce((sum, b) => sum + b.net, 0);
      recordGameResult({
        guildId: channel.guildId,
        channelId: channel.id,
        userId: uid,
        game: "race",
        result: {
          finish_order: podium,
          bets: userBets,
          net,
        },
      });
    }
  } catch (_) {}

  if (game.guildId && Object.keys(horseDeltas).length > 0) {
    try {
      const serialized = {};
      for (const [name, d] of Object.entries(horseDeltas)) {
        serialized[name] = { ...d, bettorIds: Array.from(d.bettorIds) };
      }
      await applyRaceAggregates(game.guildId, serialized, {
        biggestSingleBet: topSingleBet,
        biggestSinglePayout: topSinglePayout,
      });
    } catch (err) {
      logger.warn(`[race] failed to write guild aggregates for ${game.guildId}: ${err.message}`);
    }
  }

  for (const result of results) {
    const net = result.won ? (result.winnings - result.amount) : -result.amount;
    await db.add(`${result.userId}.stats.race.profit`, net);
  }

  const totalWagered = game.bets.reduce((sum, b) => sum + b.amount, 0);
  const totalPaid = results.filter(r => r.won).reduce((sum, r) => sum + r.winnings, 0);

  const positionPrefix = (pos) => {
    if (pos === 0) return "🥇";
    if (pos === 1) return "🥈";
    if (pos === 2) return "🥉";
    return `\`${String(pos + 1).padStart(2, " ")}.\``;
  };

  const resultsLines = [
    `**${finishCommentary}**`,
    "",
    "**Final Standings:**",
  ];
  for (let pos = 0; pos < finishOrder.length; pos++) {
    const horse = horses[finishOrder[pos]];
    resultsLines.push(`${positionPrefix(pos)} **Horse ${horse.number}: ${horse.name}** ${horse.emoji} [${horse.displayOdds}x]`);
  }
  resultsLines.push(
    "",
    "```",
    finalDescription,
    "```",
    "",
    `**Total wagered:** ${totalWagered.toLocaleString("en-US")} ${CURRENCY_NAME}`,
    `**Total paid:** ${totalPaid.toLocaleString("en-US")} ${CURRENCY_NAME}`,
  );

  const resultsSection = buildResultsSection(summarizeBettors(results), horses, CURRENCY_NAME);

  embed.setTitle("🏁 Race Results 🏁");
  embed.setDescription(fitDescription(resultsLines, resultsSection));
  // Collective outcome, so win and loss color belongs in the DM instead.
  embed.setColor(game.colors.identity);

  // Reposted again so the outcome cannot be buried by traffic during the run.
  // Nothing is lost by dropping the animation message — the final frame is
  // reproduced inside these results.
  const resultsMessage = await repostRaceMessage(channel, raceMessage, { embeds: [embed] });
  game.messageId = resultsMessage?.id ?? game.messageId;

  // Aggregate results by user so each participant gets a single rolled-up DM
  // covering every bet they placed this race.
  const byUser = {};
  for (const result of results) {
    if (!byUser[result.userId]) byUser[result.userId] = { username: result.username, bets: [], net: 0 };
    const entry = byUser[result.userId];
    entry.bets.push(result);
    entry.net += result.won ? (result.winnings - result.amount) : -result.amount;
  }

  for (const [uid, agg] of Object.entries(byUser)) {
    try {
      const dmUser = await client.users.fetch(uid);
      const newBalance = await db.get(`${uid}.balance`) ?? 0;
      // The DM is one person's, so it wears their theme rather than the creator's.
      const dmColors = await resolveRaceColors(uid);

      const betLines = agg.bets.map(b => {
        const horse = horses[b.horseIndex];
        const betTypeLabel = formatBetType(b.betType);
        const positionText = b.horsePosition === 0
          ? "1st 🥇"
          : b.horsePosition === 1
            ? "2nd 🥈"
            : b.horsePosition === 2
              ? "3rd 🥉"
              : `${b.horsePosition + 1}th`;
        const outcome = b.won
          ? `**+${b.winnings.toLocaleString("en-US")}** ${CURRENCY_NAME}`
          : `**-${b.amount.toLocaleString("en-US")}** ${CURRENCY_NAME}`;
        return `${b.won ? "✅" : "❌"} Horse ${horse.number} ${horse.emoji} (${betTypeLabel}), bet ${b.amount.toLocaleString("en-US")}, finished ${positionText} → ${outcome}`;
      });

      const dmEmbed = new EmbedBuilder()
        .setTitle(agg.net > 0 ? "🎉 You Won!" : (agg.net < 0 ? "😔 You Lost" : "🏇 Race Results"))
        .setDescription([
          `**Bets placed:** ${agg.bets.length}`,
          "",
          betLines.join("\n"),
          "",
          `**Net:** ${agg.net >= 0 ? "+" : ""}${agg.net.toLocaleString("en-US")} ${CURRENCY_NAME}`,
          `**New balance:** ${newBalance.toLocaleString("en-US")} ${CURRENCY_NAME}`,
        ].join("\n"))
        .setColor(agg.net > 0 ? dmColors.win : (agg.net < 0 ? dmColors.loss : dmColors.identity))
        .setTimestamp();

      await sendDM(dmUser, { embeds: [dmEmbed] });
    } catch (e) {
      logger.debug(`Could not send DM to user ${uid}: ${e.message}`);
    }
  }

  logger.log(`Race in channel ${game.channelId} completed. Top 3: ${winner.number} (${winner.name}), ${secondPlace.number} (${secondPlace.name}), ${thirdPlace.number} (${thirdPlace.name}). Bets: ${game.bets.length}, Wagered: ${totalWagered}, Paid: ${totalPaid}`);
}
