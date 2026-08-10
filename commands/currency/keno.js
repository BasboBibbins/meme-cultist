const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { addNewDBUser, db } = require("../../database");
const {
  CURRENCY_NAME, KENO_MIN_BET, KENO_MAX_BET, KENO_DEFAULT_QUICK_PICK,
} = require("../../config.js");
const { parseBet } = require("../../utils/betparse");
const {
  KENO_MAX_SPOTS, KENO_DRAW_COUNT, KENO_TOTAL_NUMBERS,
  parseSpots, quickPick, resolveKeno, expectedReturn,
} = require("../../utils/keno");
const { drawKenoResult, drawPaytable } = require("../../utils/kenoCanvas");
const { getThemeColors } = require("../../themes/resolver");
const { getEquippedTheme } = require("../../themes/manager");
const { withUserLock } = require("../../utils/userlock");
const { recordGameResult } = require("../../utils/gameResults");
const logger = require("../../utils/logger");
const { buildErrorEmbed, buildBaseEmbed } = require("../../utils/embeds");

async function kenoColors(userId) {
  return getThemeColors(await getEquippedTheme(userId), "keno");
}

function resultTitle(outcome, matches, spots) {
  if (outcome === "win") return `You hit ${matches} of ${spots}!`;
  if (outcome === "push") return `${matches} of ${spots} — your stake back`;
  return matches > 0 ? `Only ${matches} of ${spots}.` : "No matches.";
}

async function applyOutcome(userId, bet, result) {
  const { payout, net, outcome } = result;

  await withUserLock(userId, async () => {
    if (payout > 0) await db.add(`${userId}.balance`, payout);
    await db.add(`${userId}.stats.keno.totalBet`, bet);
    await db.add(`${userId}.stats.keno.profit`, net);

    if (outcome === "win") {
      await db.add(`${userId}.stats.keno.wins`, 1);
      if (net > ((await db.get(`${userId}.stats.keno.biggestWin`)) || 0)) {
        await db.set(`${userId}.stats.keno.biggestWin`, net);
      }
    } else if (outcome === "loss") {
      await db.add(`${userId}.stats.keno.losses`, 1);
      if (bet > ((await db.get(`${userId}.stats.keno.biggestLoss`)) || 0)) {
        await db.set(`${userId}.stats.keno.biggestLoss`, bet);
      }
    } else {
      await db.add(`${userId}.stats.keno.pushes`, 1);
    }
  });
}

async function handlePlay(interaction) {
  const user = interaction.user;
  const client = interaction.client;

  const betOption = interaction.options.getString("bet");
  const numbersOption = interaction.options.getString("numbers");
  const spotsOption = interaction.options.getInteger("spots");

  let spots;
  if (numbersOption) {
    const parsed = parseSpots(numbersOption);
    if (parsed.error) {
      return interaction.reply({ embeds: [buildErrorEmbed(user, client, parsed.error)], flags: MessageFlags.Ephemeral });
    }
    spots = parsed.spots;
  } else {
    spots = quickPick(spotsOption ?? KENO_DEFAULT_QUICK_PICK);
  }

  const bet = await parseBet(betOption, user.id);
  if (isNaN(bet) || bet % 1 !== 0) {
    return interaction.reply({ embeds: [buildErrorEmbed(user, client, `You must bet a whole number of ${CURRENCY_NAME}!`)], flags: MessageFlags.Ephemeral });
  }
  if (bet < KENO_MIN_BET) {
    return interaction.reply({ embeds: [buildErrorEmbed(user, client, `The minimum keno bet is **${KENO_MIN_BET.toLocaleString("en-US")}** ${CURRENCY_NAME}.`)], flags: MessageFlags.Ephemeral });
  }
  if (KENO_MAX_BET > 0 && bet > KENO_MAX_BET) {
    return interaction.reply({ embeds: [buildErrorEmbed(user, client, `The maximum keno bet is **${KENO_MAX_BET.toLocaleString("en-US")}** ${CURRENCY_NAME}.`)], flags: MessageFlags.Ephemeral });
  }

  const debited = await withUserLock(user.id, async () => {
    const balance = (await db.get(`${user.id}.balance`)) ?? 0;
    if (balance < bet) return false;
    await db.sub(`${user.id}.balance`, bet);
    return true;
  });
  if (!debited) {
    const balance = (await db.get(`${user.id}.balance`)) ?? 0;
    return interaction.reply({
      embeds: [buildErrorEmbed(user, client, `You don't have enough ${CURRENCY_NAME}! You need **${bet.toLocaleString("en-US")}** and have **${balance.toLocaleString("en-US")}**.`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  let result;
  try {
    await interaction.deferReply();
    result = resolveKeno({ spots, bet });
    await applyOutcome(user.id, bet, result);
  } catch (err) {
    await db.add(`${user.id}.balance`, bet);
    logger.error(`[keno] refunded ${bet} to ${user.id} after a failed round: ${err && err.stack || err}`);
    throw err;
  }

  await db.set(`${user.id}.keno.lastBet`, betOption.trim());
  await db.set(`${user.id}.keno.lastSpots`, spots);

  const balance = (await db.get(`${user.id}.balance`)) ?? 0;
  const colors = await kenoColors(user.id);
  const attachment = await drawKenoResult({
    spots,
    drawn: result.drawn,
    matched: result.matched,
    matches: result.matches,
    bet,
    multiplier: result.multiplier,
    payout: result.payout,
    net: result.net,
    balance,
    currencyName: CURRENCY_NAME,
  }, colors);

  const netLine = result.net > 0
    ? `You won **${result.net.toLocaleString("en-US")}** ${CURRENCY_NAME}!`
    : result.net < 0
      ? `You lost **${bet.toLocaleString("en-US")}** ${CURRENCY_NAME}.`
      : `You got your **${bet.toLocaleString("en-US")}** ${CURRENCY_NAME} back.`;

  const embed = buildBaseEmbed(user, client)
    .setColor(colors.embedColor ?? 0x0f4c25)
    .setTitle(resultTitle(result.outcome, result.matches, spots.length))
    .setDescription([
      netLine,
      `Balance: **${balance.toLocaleString("en-US")}** ${CURRENCY_NAME}${balance <= 0 ? " — you're now broke!" : ""}`,
    ].join("\n"))
    .setImage("attachment://keno.png");

  logger.log(`Keno: ${user.username} (${user.id}) played ${spots.length} spots for ${bet} ${CURRENCY_NAME} — ${result.matches} matches, ${result.outcome}, net ${result.net}`);

  try {
    recordGameResult({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: user.id,
      game: "keno",
      result: {
        spots,
        drawn: result.drawn,
        matched: result.matched,
        matches: result.matches,
        bet,
        multiplier: result.multiplier,
        payout: result.payout,
        net: result.net,
        outcome: result.outcome,
        quick_pick: !numbersOption,
      },
    });
  } catch (_) {}

  return interaction.editReply({ embeds: [embed], files: [attachment] });
}

async function handlePaytable(interaction) {
  const user = interaction.user;
  const client = interaction.client;

  let spots = interaction.options.getInteger("spots");
  if (!spots) {
    const lastSpots = await db.get(`${user.id}.keno.lastSpots`);
    if (Array.isArray(lastSpots) && lastSpots.length > 0) spots = lastSpots.length;
  }

  await interaction.deferReply();

  const colors = await kenoColors(user.id);
  const attachment = await drawPaytable(colors, { spots });

  const embed = buildBaseEmbed(user, client)
    .setColor(colors.embedColor ?? 0x0f4c25)
    .setTitle(spots ? `Keno paytable — ${spots} spot${spots === 1 ? "" : "s"}` : "Keno paytable")
    .setDescription(spots
      ? `Pick ${spots} number${spots === 1 ? "" : "s"} from 1–${KENO_TOTAL_NUMBERS}; ${KENO_DRAW_COUNT} are drawn. This table returns **${(expectedReturn(spots) * 100).toFixed(1)}%** over time.`
      : `Pick 1–${KENO_MAX_SPOTS} numbers from 1–${KENO_TOTAL_NUMBERS}; ${KENO_DRAW_COUNT} are drawn. Use \`/keno paytable spots:<n>\` for a single row with its odds.`)
    .setImage("attachment://keno-paytable.png");

  return interaction.editReply({ embeds: [embed], files: [attachment] });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("keno")
    .setDescription(`Pick numbers and match the draw to win ${CURRENCY_NAME}.`)
    .addSubcommand(s => s
      .setName("play")
      .setDescription(`Pick up to ${KENO_MAX_SPOTS} numbers and bet on the draw.`)
      .addStringOption(o => o
        .setName("bet")
        .setDescription("The amount to bet (e.g. 100, half, max / 2).")
        .setRequired(true))
      .addStringOption(o => o
        .setName("numbers")
        .setDescription("Your picks — e.g. 3, 17, 29. Omit these to quick-pick.")
        .setRequired(false))
      .addIntegerOption(o => o
        .setName("spots")
        .setDescription(`How many numbers to quick-pick (1-${KENO_MAX_SPOTS}). Ignored if numbers is given.`)
        .setMinValue(1)
        .setMaxValue(KENO_MAX_SPOTS)
        .setRequired(false)))
    .addSubcommand(s => s
      .setName("paytable")
      .setDescription("View the keno payouts and odds.")
      .addIntegerOption(o => o
        .setName("spots")
        .setDescription(`Show the table for a single spot count (1-${KENO_MAX_SPOTS}).`)
        .setMinValue(1)
        .setMaxValue(KENO_MAX_SPOTS)
        .setRequired(false))),

  async execute(interaction) {
    const user = interaction.user;

    if (!(await db.get(user.id))) {
      logger.warn(`No database entry for user ${user.username} (${user.id}), creating one...`);
      await addNewDBUser(user);
    }

    try {
      if (interaction.options.getSubcommand() === "paytable") return await handlePaytable(interaction);
      return await handlePlay(interaction);
    } catch (err) {
      logger.error(`[keno] ${err && err.stack || err}`);
      const embed = buildErrorEmbed(user, interaction.client, "Something went wrong running that keno round.");
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ embeds: [embed], files: [] }).catch(() => {});
      }
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  },
};
