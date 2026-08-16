const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require("discord.js");
const { addNewDBUser, db } = require("../../database");
const { CURRENCY_NAME, RACE_MIN_BET, RACE_MAX_BET, RACE_BETTING_TIME, RACE_HOUSE_EDGE, RACE_ANIMATION_TICKS, RACE_TICK_INTERVAL } = require("../../config.js");
const { openBetModal } = require("../../utils/betModal");
const { parseBet } = require("../../utils/betparse");
const { withUserLock } = require("../../utils/userlock");
const { applyRaceAggregates } = require("../../utils/guildStats");
const { generateHorses, determineTopThree, calculatePayout, effectiveMultiplier, buildBettingDescription, buildRaceDescription, buildRaceTitle, advanceRace, generateRaceCommentary, summarizeBettors, buildResultsSection, fitDescription, truncateCells, COMMENTARY_GUARD_TIMEOUT } = require("../../utils/race");
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
const COMMENTARY_TIMEOUT = COMMENTARY_GUARD_TIMEOUT;
const HOUSE_CUT_LABEL = `${Math.round(HOUSE_EDGE * 100)}%`;

// "Win / place / show" means nothing to anyone who has not been to a racetrack, and the multiplier is the part people act on.
const BET_TYPE_OPTIONS = [
  { label: "Win", value: "win", blurb: "Must finish 1st" },
  { label: "Place", value: "place", blurb: "1st or 2nd" },
  { label: "Show", value: "show", blurb: "Top 3" },
];

function betTypeOptions(horse, selected) {
  return BET_TYPE_OPTIONS.map(({ label, value, blurb }) => ({
    label,
    value,
    description: `${blurb}. Pays ${effectiveMultiplier(horse.displayOdds, HOUSE_EDGE, value)}x your stake.`,
    default: value === selected,
  }));
}

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
function buildStoppedEmbed(client, game, description, title = "Race Cancelled") {
  return new EmbedBuilder()
    .setAuthor({ name: "🏇 Horse Race", iconURL: client.user.displayAvatarURL({ dynamic: true }) })
    .setTitle(title)
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

const BETTING_CLOSED_REFUNDED = "Betting closed while your bet was being placed, refunded.";

// Shared by the button and slash paths so the money moment cannot drift into two versions.
async function buildBetConfirmEmbed(user, game, horse, amount, betType) {
  const balance = await db.get(`${user.id}.balance`) ?? 0;
  return new EmbedBuilder()
    .setAuthor({ name: "Bet Placed", iconURL: user.displayAvatarURL({ dynamic: true }) })
    .setDescription([
      `**${amount.toLocaleString("en-US")}** ${CURRENCY_NAME} on **Horse ${horse.number}: ${horse.name}** ${horse.emoji}`,
      `**${formatBetType(betType)}** at ${horse.displayOdds}x`,
      "",
      `**Pays if it lands:** ${calculatePayout(amount, horse.displayOdds, HOUSE_EDGE, betType).toLocaleString("en-US")} ${CURRENCY_NAME}, after the ${HOUSE_CUT_LABEL} cut`,
      `**Wallet now:** ${balance.toLocaleString("en-US")} ${CURRENCY_NAME}`,
    ].join("\n"))
    .setColor(game.colors.identity)
    .setTimestamp();
}

// Stake and its wagered-total stat move together under one lock, or a concurrent clear leaves the two disagreeing.
async function debitStake(userId, amount) {
  return withUserLock(userId, async () => {
    const balance = await db.get(`${userId}.balance`) ?? 0;
    if (balance < amount) return false;
    await db.sub(`${userId}.balance`, amount);
    await db.add(`${userId}.stats.race.totalBet`, amount);
    return true;
  });
}

async function refundStake(userId, amount) {
  if (!(amount > 0)) return;
  await withUserLock(userId, async () => {
    await db.add(`${userId}.balance`, amount);
    await db.sub(`${userId}.stats.race.totalBet`, amount);
  });
}

// Draining rather than reading is what makes a double refund impossible when two paths race to settle the same game.
function takeBets(game) {
  const taken = game.bets;
  game.bets = [];
  return taken;
}

// One user's stakes collapse into a single lock, and one failed refund never strands the rest.
async function refundBets(bets) {
  const byUser = {};
  for (const bet of bets) {
    byUser[bet.userId] = (byUser[bet.userId] || 0) + bet.amount;
  }
  let refunded = 0;
  for (const [uid, amount] of Object.entries(byUser)) {
    try {
      await refundStake(uid, amount);
      refunded += amount;
    } catch (err) {
      logger.error(`[race] refund failed for ${uid} (${amount}): ${err && err.stack || err}`);
    }
  }
  return refunded;
}

// Two horses per row rather than four: the label carries a number, a name and
// the odds, which the mobile client truncates to unreadable stubs at quarter
// width. Eight horses fill four rows, and the controls take the fifth — the
// message is at Discord's five-row ceiling, so another row cannot be added.
const HORSES_PER_ROW = 2;
// Discord clips a half-width label from the right, so an untrimmed name ate the odds. Trimming here keeps them.
const BUTTON_NAME_CELLS = 12;

function buildComponents(horses, disabled = false) {
  const sorted = [...horses].sort((a, b) => a.number - b.number);
  const horseRows = [];
  for (let i = 0; i < sorted.length; i++) {
    const h = sorted[i];
    const btn = new ButtonBuilder()
      .setCustomId(`race_bet_${h.number}`)
      .setLabel(`${h.number}: ${truncateCells(h.name, BUTTON_NAME_CELLS)} [${h.displayOdds}x]`)
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
      commentaryPromise = generateRaceCommentary(horses);
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

        const cancelled = takeBets(game);
        const refunded = await refundBets(cancelled);

        // Set before the collector stops, or the end handler reads this as an abandon and posts over the cancel notice.
        game.phase = "cancelled";
        await i.update({
          embeds: [buildStoppedEmbed(client, game, refunded > 0
            ? `Cancelled by **${game.creatorUsername}**. Refunded **${refunded.toLocaleString("en-US")}** ${CURRENCY_NAME} across ${cancelled.length} bet${cancelled.length === 1 ? "" : "s"}.`
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
    if (game.phase !== "betting") return;

    const ownsChannel = client.raceGames.get(channelId) === game;
    if (ownsChannel && (reason === "time" || reason === "start")) {
      await resolveRace(client, channel, message, game);
      return;
    }

    // Every other stop reason ends the race without running it, so the stakes have to come back.
    await abandonRace(client, channel, message, game, reason);
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
    logger.warn(`Failed to generate race commentary: ${e?.message ?? String(e)}`);
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

  // Discord caps a modal title at 45 characters, and a generated name can eat all of it.
  const namedTitle = `Horse ${horse.number}: ${horse.name} (${horse.displayOdds}x)`;

  const modalOpts = {
    title: namedTitle.length <= 45 ? namedTitle : `Horse ${horse.number} (${horse.displayOdds}x)`,
    min: RACE_MIN_BET,
    extras: [{
      type: "radio",
      customId: "betType",
      label: "Bet Type",
      description: `Payouts are after the ${HOUSE_CUT_LABEL} house cut.`,
      options: betTypeOptions(horse, cachedBetType),
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
    return submit.reply({ embeds: [buildErrorEmbed(submit.user, submit.client,"Pick a bet type: win, place, or show.")], flags: MessageFlags.Ephemeral });
  }

  const current = client.raceGames.get(game.channelId);
  if (current !== game || current.phase !== "betting") {
    return submit.reply({ embeds: [buildErrorEmbed(submit.user, submit.client, "Betting is no longer open for this race.")], flags: MessageFlags.Ephemeral });
  }

  const debited = await debitStake(user.id, amount);
  if (!debited) {
    return submit.reply({ embeds: [buildErrorEmbed(submit.user, submit.client, "Insufficient funds in wallet!")], flags: MessageFlags.Ephemeral });
  }

  // The debit is an await, so the race can resolve underneath it. Without this the stake is gone and no bet exists.
  const stillBetting = client.raceGames.get(game.channelId);
  if (stillBetting !== game || stillBetting.phase !== "betting") {
    await refundStake(user.id, amount);
    return submit.reply({ embeds: [buildErrorEmbed(submit.user, submit.client, BETTING_CLOSED_REFUNDED)], flags: MessageFlags.Ephemeral });
  }

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

  const confirmEmbed = await buildBetConfirmEmbed(user, current, horse, amount, betTypeRaw);
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

  const debited = await debitStake(user.id, amount);
  if (!debited) {
    const currentBalance = await db.get(`${user.id}.balance`) ?? 0;
    return interaction.editReply({
      embeds: [buildErrorEmbed(user, client, `Insufficient funds! You have **${currentBalance.toLocaleString("en-US")}** ${CURRENCY_NAME}.`)],
    });
  }

  const current = client.raceGames.get(channelId);
  if (current !== game || current.phase !== "betting") {
    await refundStake(user.id, amount);
    return interaction.editReply({
      embeds: [buildErrorEmbed(user, client, BETTING_CLOSED_REFUNDED)],
    });
  }

  // Cached so the next button-driven modal pre-fills, keeping the slash and button paths in sync.
  await db.set(`${user.id}.race.lastBet`, expression);
  await db.set(`${user.id}.race.lastBetType`, betTypeRaw);

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

  const confirmEmbed = await buildBetConfirmEmbed(user, current, horse, amount, betTypeRaw);
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
    return submit.reply({ embeds: [buildErrorEmbed(submit.user, submit.client,"Betting is no longer open, so your bets are already locked in.")], flags: MessageFlags.Ephemeral });
  }

  const standingBets = current.bets.filter(b => b.userId === user.id);
  if (standingBets.length === 0) {
    return submit.reply({ embeds: [buildErrorEmbed(submit.user, submit.client,"You no longer have any standing bets to clear.")], flags: MessageFlags.Ephemeral });
  }

  const refund = standingBets.reduce((sum, b) => sum + b.amount, 0);
  current.bets = current.bets.filter(b => b.userId !== user.id);

  await refundStake(user.id, refund);

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

const PLAY_AGAIN_WINDOW = 300000;

function buildPlayAgainRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("race_play_again")
      .setLabel("Race Again")
      .setEmoji("🏇")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
  );
}

// The lobby cannot host this: eight horses and the controls already fill Discord's five rows. The results message has all five free.
function attachPlayAgain(client, resultsMessage) {
  if (!resultsMessage) return;

  const collector = resultsMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: PLAY_AGAIN_WINDOW,
  });

  collector.on("collect", async (i) => {
    if (i.customId !== "race_play_again") return;
    collector.stop("used");
    await resultsMessage.edit({ components: [buildPlayAgainRow(true)] }).catch(() => {});
    try {
      await handleStartRace(i, client, i.user);
    } catch (err) {
      logger.error(`[race] play again failed in ${i.channelId}: ${err && err.stack || err}`);
    }
  });

  collector.on("end", (_collected, reason) => {
    if (reason === "used") return;
    resultsMessage.edit({ components: [] }).catch(() => {});
  });
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

// The panel is the first casualty of a messageDelete abandon, so the notice falls back to a fresh channel message.
async function announceStopped(client, channel, message, game, description, title) {
  const payload = { embeds: [buildStoppedEmbed(client, game, description, title)], components: [] };
  try {
    await message.edit(payload);
    return;
  } catch (err) {
    logger.debug(`[race] could not edit panel for stop notice in ${game.channelId}: ${err.message}`);
  }
  await channel.send({ embeds: payload.embeds }).catch(() => {});
}

// Reached when the collector dies for any reason that is not a real start: the race never runs, so nobody stays debited.
async function abandonRace(client, channel, message, game, reason) {
  game.phase = "abandoned";
  try {
    const abandoned = takeBets(game);
    const refunded = await refundBets(abandoned);
    logger.warn(`[race] abandoned in ${game.channelId} (${reason}): refunded ${refunded} across ${abandoned.length} bet(s)`);
    if (abandoned.length > 0) {
      await announceStopped(client, channel, message, game, `The race fell over before it could run. Refunded **${refunded.toLocaleString("en-US")}** ${CURRENCY_NAME} across ${abandoned.length} bet${abandoned.length === 1 ? "" : "s"}. Start another with \`/race start\`.`, "Race Abandoned");
    }
  } catch (err) {
    logger.error(`[race] abandon failed in ${game.channelId}: ${err && err.stack || err}`);
  } finally {
    if (client.raceGames.get(game.channelId) === game) client.raceGames.delete(game.channelId);
  }
}

// Releases the channel slot whatever happens below. A throw mid-resolve used to wedge the channel until restart.
async function resolveRace(client, channel, message, game) {
  let resultsMessage = null;
  try {
    resultsMessage = await runRace(client, channel, message, game);
  } catch (err) {
    logger.error(`[race] resolve failed in ${game.channelId}: ${err && err.stack || err}`);
    // runRace removes each stake from game.bets as it settles it, so whatever is left here was never paid out.
    const unsettled = takeBets(game);
    const refunded = await refundBets(unsettled);
    if (unsettled.length > 0) {
      logger.warn(`[race] refunded ${refunded} across ${unsettled.length} unsettled bet(s) in ${game.channelId}`);
      await announceStopped(client, channel, message, game, `The race broke down before every bet was settled. Refunded **${refunded.toLocaleString("en-US")}** ${CURRENCY_NAME} across ${unsettled.length} unsettled bet${unsettled.length === 1 ? "" : "s"}.`, "Race Broke Down");
    }
  } finally {
    if (client.raceGames.get(game.channelId) === game) client.raceGames.delete(game.channelId);
  }

  // Armed only once the channel slot is free, or the first click races the DM loop and is told a race is already running.
  attachPlayAgain(client, resultsMessage);
}

async function runRace(client, channel, message, game) {
  game.phase = "racing";

  await message.edit({ components: [] }).catch(() => {});

  const horses = game.horses;
  const positions = new Array(8).fill(0);
  let finishOrder = [];

  if (game.bets.length === 0) {
    const embed = buildStoppedEmbed(client, game, "Nobody put anything down, so the horses went home. Start another with `/race start`.", "Nobody Bet");
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
  let winnerTitle = null;

  for (let tick = 1; tick <= ANIMATION_TICKS; tick++) {
    const result = advanceRace(horses, positions, game.topThree, tick, ANIMATION_TICKS);

    for (const idx of result.newFinishers) {
      if (!finishOrder.includes(idx)) {
        finishOrder.push(idx);
      }
    }

    // The upset line is the payoff for the whole animation, so it lands on the lap the leader crosses and holds while the pack comes home.
    if (!winnerTitle && finishOrder.includes(game.topThree.firstIndex)) {
      winnerTitle = buildRaceTitle(game.commentary, tick, ANIMATION_TICKS, horses, positions, game.topThree.firstIndex, finishOrder);
    }

    const description = buildRaceDescription(horses, positions, tick, ANIMATION_TICKS, null, finishOrder, game.topThree, game.bets);
    const commentary = winnerTitle ?? buildRaceTitle(game.commentary, tick, ANIMATION_TICKS, horses, positions, null, finishOrder);
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

  const winner = horses[game.topThree.firstIndex];
  const secondPlace = horses[game.topThree.secondIndex];
  const thirdPlace = horses[game.topThree.thirdIndex];
  // Reused rather than re-rolled, so the results headline is the same sentence people just watched land.
  const finishCommentary = winnerTitle ?? buildRaceTitle(game.commentary, ANIMATION_TICKS, ANIMATION_TICKS, horses, positions, game.topThree.firstIndex, finishOrder);

  const results = [];
  // Per-horse-name accumulator for the guild aggregate write at the end of
  // the resolve. Bundling avoids N writes per race.
  const horseDeltas = {};
  let topSingleBet = null;
  let topSinglePayout = null;

  const wagered = game.bets.slice();

  for (const bet of wagered) {
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
      // The payout and the personal-best read-modify-write share a lock, or two races resolving at once drop an update.
      await withUserLock(bet.userId, async () => {
        await db.add(`${bet.userId}.balance`, winnings);
        const biggestWin = await db.get(`${bet.userId}.stats.race.biggestWin`) || 0;
        if (winnings > biggestWin) {
          await db.set(`${bet.userId}.stats.race.biggestWin`, winnings);
          await db.set(`${bet.userId}.stats.race.biggestWinHorse`, horseSnapshot);
        }
      });
      await db.add(`${bet.userId}.stats.race.wins`, 1);

      if (betType === "place") {
        await db.add(`${bet.userId}.stats.race.placeWins`, 1);
      } else if (betType === "show") {
        await db.add(`${bet.userId}.stats.race.showWins`, 1);
      }
    } else {
      await db.add(`${bet.userId}.stats.race.losses`, 1);

      await withUserLock(bet.userId, async () => {
        const biggestLoss = await db.get(`${bet.userId}.stats.race.biggestLoss`) || 0;
        if (bet.amount > biggestLoss) {
          await db.set(`${bet.userId}.stats.race.biggestLoss`, bet.amount);
          await db.set(`${bet.userId}.stats.race.biggestLossHorse`, horseSnapshot);
        }
      });
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

    // Settled stakes leave the refundable set one at a time, so a throw below refunds only what this loop never reached.
    const settledIndex = game.bets.indexOf(bet);
    if (settledIndex !== -1) game.bets.splice(settledIndex, 1);
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
  } catch (err) {
    logger.warn(`[race] failed to record game results in ${game.channelId}: ${err.message}`);
  }

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

  const totalWagered = wagered.reduce((sum, b) => sum + b.amount, 0);
  const totalPaid = results.filter(r => r.won).reduce((sum, r) => sum + r.winnings, 0);

  const MEDALS = ["🥇", "🥈", "🥉"];
  const podiumLines = finishOrder.slice(0, MEDALS.length).map((idx, pos) => {
    const horse = horses[idx];
    return `${MEDALS[pos]} **Horse ${horse.number}: ${horse.name}** ${horse.emoji} [${horse.displayOdds}x]`;
  });

  // The rest of the field as numbers on one line: a bettor still finds where their horse landed without five more rows.
  const alsoRan = finishOrder.slice(MEDALS.length).map(idx => `#${horses[idx].number}`);

  // Payouts lead and are never trimmed. Standings and totals are the safety valve, which the length guard drops first.
  const payoutLines = buildResultsSection(summarizeBettors(results), horses, CURRENCY_NAME);
  const standingsLines = [
    "",
    "**Final Standings:**",
    ...podiumLines,
    ...(alsoRan.length > 0 ? [`**Then:** ${alsoRan.join(" · ")}`] : []),
    "",
    `**Wagered:** ${totalWagered.toLocaleString("en-US")} ${CURRENCY_NAME} · **Paid:** ${totalPaid.toLocaleString("en-US")} ${CURRENCY_NAME}`,
  ];

  embed.setTitle("🏁 Race Results 🏁");
  embed.setDescription(fitDescription([`**${finishCommentary}**`, ...payoutLines], standingsLines));
  // Collective outcome, so win and loss color belongs in the DM instead.
  embed.setColor(game.colors.identity);

  // Reposted so the outcome cannot be buried by traffic during the run.
  const resultsMessage = await repostRaceMessage(channel, raceMessage, { embeds: [embed], components: [buildPlayAgainRow()] });
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

  logger.log(`Race in channel ${game.channelId} completed. Top 3: ${winner.number} (${winner.name}), ${secondPlace.number} (${secondPlace.name}), ${thirdPlace.number} (${thirdPlace.name}). Bets: ${wagered.length}, Wagered: ${totalWagered}, Paid: ${totalPaid}`);

  return resultsMessage;
}
