const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ComponentType, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");
const { addNewDBUser, db } = require("../../database");
const {
  CURRENCY_NAME, SLOTS_MAX_LINES, SLOTS_DAILY_COOLDOWN, SLOTS_DAILY_LINES,
  PANEL_IDLE_TIMEOUT,
} = require("../../config.js");
const { openBetModal, resolveBet } = require("../../utils/betModal");
const { generatePaytable, buildPaytablePayload, playSlots } = require("../../utils/slots");
const { drawSlotMachine } = require("../../utils/slotsCanvas");
const { getTheme } = require("../../utils/slotsThemes");
const { getEquippedTheme } = require("../../themes/manager");
const { getJackpotDisplay } = require("../../utils/jackpot");
const { withUserLock } = require("../../utils/userlock");
const { formatTimeLeft } = require("../../utils/time");
const logger = require("../../utils/logger");
const { buildErrorEmbed } = require("../../utils/embeds");

const PACKAGE_VERSION = require("../../package.json").version;
const PANEL_IDLE = PANEL_IDLE_TIMEOUT || 5 * 60 * 1000;

// ─── helpers ─────────────────────────────────────────────────────────────────


function footerText(client) {
  return `${client.user.username} | Version ${PACKAGE_VERSION}`;
}

function sessionKey(channelId, userId) {
  return `${channelId}:${userId}`;
}

// ─── panel components ────────────────────────────────────────────────────────

function buildPanelComponents() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("slots_spin").setLabel("Spin").setEmoji("🎰").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("slots_bet").setLabel("Change Bet").setEmoji("💰").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("slots_lines").setLabel("Change Lines").setEmoji("📏").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("slots_paytable").setLabel("Paytable").setEmoji("📖").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("slots_leave").setLabel("Leave").setEmoji("🚪").setStyle(ButtonStyle.Danger),
  );
  return [row1];
}

function buildDisabledPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("slots_spin").setLabel("Spin").setEmoji("🎰").setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId("slots_bet").setLabel("Change Bet").setEmoji("💰").setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId("slots_lines").setLabel("Change Lines").setEmoji("📏").setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId("slots_paytable").setLabel("Paytable").setEmoji("📖").setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId("slots_leave").setLabel("Leave").setEmoji("🚪").setStyle(ButtonStyle.Danger).setDisabled(true),
    ),
  ];
}

function buildPanelEmbed(user, client, balance, lastBet, lastLines, lastResultDesc) {
  const betLine = lastBet > 0
    ? `Bet: **${lastBet.toLocaleString("en-US")}** ${CURRENCY_NAME} × **${lastLines}** line${lastLines === 1 ? "" : "s"} = **${(lastBet * lastLines).toLocaleString("en-US")}** ${CURRENCY_NAME}/spin`
    : "No bet set — click **Spin** or **Change Bet** to begin.";
  const balLine = `Balance: **${balance.toLocaleString("en-US")}** ${CURRENCY_NAME}`;

  const embed = new EmbedBuilder()
    .setAuthor({ name: `${user.displayName}'s slot machine`, iconURL: user.displayAvatarURL({ dynamic: true }) })
    .setColor(0x0f4c25)
    .setFooter({ text: footerText(client), iconURL: client.user.displayAvatarURL({ dynamic: true }) })
    .setTimestamp();

  embed.setDescription(lastResultDesc
    ? `${lastResultDesc}\n\n${betLine}\n${balLine}`
    : `${betLine}\n${balLine}`);

  return embed;
}

// ─── idle slot machine render for the initial panel ──────────────────────────

function idleGrid() {
  // A static 3x3 grid of low-value symbols for the placeholder render.
  return [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
  ];
}

async function buildIdlePanelAttachment(user, lastBet, lastLines) {
  const themeId = await getEquippedTheme(user.id);
  const theme = getTheme(themeId);
  const jackpotDisplay = await getJackpotDisplay();
  return drawSlotMachine(idleGrid(), {
    jackpotDisplay,
    activeLines: Math.max(1, lastLines || 1),
    bet: lastBet || 0,
    totalWin: 0,
    balance: await db.get(`${user.id}.balance`) ?? 0,
    winResults: [],
    theme,
  });
}

// ─── session helpers ─────────────────────────────────────────────────────────

function createSession(userId, channelId, key, messageId, lastBet, lastLines, startBalance, lastBetExpression) {
  return {
    userId,
    channelId,
    key,
    messageId,
    lastBet: lastBet || 0,
    lastBetExpression: lastBetExpression || null,
    lastLines: Math.min(Math.max(lastLines || 1, 1), SLOTS_MAX_LINES),
    status: "waiting",
    collector: null,
    lastEphemeralInteraction: null,
    startBalance: startBalance ?? 0,
    rounds: 0,
    spins: 0,
    wins: 0,
    losses: 0,
    jackpots: 0,
    bonusesTriggered: 0,
    totalWagered: 0,
    totalReturned: 0,
    biggestWin: 0,
    biggestLoss: 0,
  };
}

async function persistPreferences(userId, lastBetExpression, lastLines) {
  if (typeof lastBetExpression === "string") {
    await db.set(`${userId}.slots.lastBet`, lastBetExpression);
  }
  if (typeof lastLines === "number") await db.set(`${userId}.slots.lastLines`, lastLines);
}

// Read the persisted lastBet expression, tolerating the pre-dynamic schema
// where it was stored as an integer. An empty/zero value means no cached bet.
function readPersistedBetExpression(dbUser) {
  const raw = dbUser?.slots?.lastBet;
  if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
  if (typeof raw === "number" && raw > 0) return String(raw);
  return null;
}

// ─── session lifecycle ───────────────────────────────────────────────────────

async function openSlotsPanel(interaction, user, client) {
  const key = sessionKey(interaction.channelId, user.id);
  const existing = client.slotsPanels.get(key);
  if (existing && existing.status !== "ended") {
    if (existing.lastEphemeralInteraction) {
      existing.lastEphemeralInteraction.deleteReply().catch(() => {});
    }
    await interaction.reply({
      embeds: [buildErrorEmbed(user, client, "You already have a slots panel open in this channel. Use the buttons on your existing message.")],
      ephemeral: true,
    });
    existing.lastEphemeralInteraction = interaction;
    return;
  }

  let dbUser = await db.get(user.id);
  if (!dbUser) {
    await addNewDBUser(user);
    dbUser = await db.get(user.id);
  }

  const balance = dbUser.balance ?? 0;
  const lastBetExpression = readPersistedBetExpression(dbUser);
  const lastLines = Math.min(Math.max(dbUser.slots?.lastLines ?? 1, 1), SLOTS_MAX_LINES);

  // Resolve the cached expression to a live number for the initial display.
  // A failed resolve (e.g. balance dropped below `max`) just leaves the panel
  // in the "no bet set" state — the next Spin click will open the modal.
  let lastBet = 0;
  if (lastBetExpression) {
    const resolved = await resolveBet(lastBetExpression, user.id, { requireBalance: false });
    if (resolved.ok) lastBet = resolved.amount;
  }

  await interaction.deferReply();
  const attachment = await buildIdlePanelAttachment(user, lastBet, lastLines);
  const embed = buildPanelEmbed(user, client, balance, lastBet, lastLines, null);
  embed.setTitle("Slots — pick a bet and pull the lever");
  if (attachment) embed.setImage("attachment://slots-result.png");

  const message = await interaction.editReply({
    embeds: [embed],
    components: buildPanelComponents(),
    files: attachment ? [attachment] : [],
  });

  const session = createSession(user.id, interaction.channelId, key, message.id, lastBet, lastLines, balance, lastBet > 0 ? lastBetExpression : null);
  client.slotsPanels.set(key, session);
  attachSessionCollector(client, message, session, interaction.channel);
}

function attachSessionCollector(client, message, session, channel) {
  if (session.collector) {
    try { session.collector.stop("replaced"); } catch (_) {}
  }

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: i => i.user.id === session.userId && [
      "slots_spin", "slots_bet", "slots_lines", "slots_paytable", "slots_leave",
    ].includes(i.customId),
    idle: PANEL_IDLE,
  });
  session.collector = collector;

  collector.on("collect", async (i) => {
    try {
      if (session.status !== "waiting") {
        return i.deferUpdate().catch(() => {});
      }
      if (i.customId === "slots_spin") return handleSpin(i, session, client, channel);
      if (i.customId === "slots_bet") return handleChangeBet(i, session, client);
      if (i.customId === "slots_lines") return handleChangeLines(i, session, client);
      if (i.customId === "slots_paytable") return handlePaytable(i, client);
      if (i.customId === "slots_leave") return endSession(client, message, session, "ended", i);
    } catch (err) {
      logger.error(`[slots] collector error: ${err && err.stack || err}`);
      try {
        if (!i.replied && !i.deferred) await i.reply({ content: "Something went wrong.", ephemeral: true });
      } catch (_) {}
    }
  });

  collector.on("end", async (_collected, reason) => {
    if (!client.slotsPanels.has(session.key)) return;
    if (reason === "idle" || reason === "time") {
      const current = client.slotsPanels.get(session.key);
      if (current && current.status === "spinning") return;
      await endSession(client, message, session, "idle", null);
    }
  });
}

async function endSession(client, message, session, reason, interaction) {
  if (!client.slotsPanels.has(session.key)) return;
  if (session.status === "ended") return;
  session.status = "ended";
  client.slotsPanels.delete(session.key);
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
    ? "Slots panel closed due to inactivity."
    : "You left the slots panel.";

  return new EmbedBuilder()
    .setAuthor({ name: `${user.displayName}'s Slots Session`, iconURL: user.displayAvatarURL?.({ dynamic: true }) || undefined })
    .setColor(color)
    .setDescription(headline)
    .addFields(
      { name: "Rounds", value: `**${session.rounds.toLocaleString("en-US")}**`, inline: true },
      { name: "Spins", value: `**${session.spins.toLocaleString("en-US")}** (${session.wins}W / ${session.losses}L)`, inline: true },
      { name: "Win Rate", value: decided > 0 ? `**${winPct.toFixed(1)}%**` : "—", inline: true },
      { name: "Wagered", value: `**${session.totalWagered.toLocaleString("en-US")}** ${CURRENCY_NAME}`, inline: true },
      { name: "Returned", value: `**${session.totalReturned.toLocaleString("en-US")}** ${CURRENCY_NAME}`, inline: true },
      { name: "Net Profit", value: profitLine, inline: true },
      { name: "Best / Worst Round", value: `+${session.biggestWin.toLocaleString("en-US")} / -${session.biggestLoss.toLocaleString("en-US")}`, inline: true },
      { name: "Bonuses Triggered", value: `**${session.bonusesTriggered}**`, inline: true },
      { name: "​", value: "​", inline: false },
      { name: "Current Balance", value: `**${newBalance.toLocaleString("en-US")}** ${CURRENCY_NAME}`, inline: false },
    )
    .setFooter({ text: footerText(client), iconURL: client.user.displayAvatarURL({ dynamic: true }) })
    .setTimestamp();
}

// ─── button handlers ─────────────────────────────────────────────────────────

async function handleSpin(buttonInt, session, client, channel) {
  const user = buttonInt.user;

  // Cached bet path — re-resolve the cached expression so dynamic bets like
  // `max * 0.2` always reflect the live balance. On failure (expression
  // resolves to 0, exceeds balance, etc.), clear the cache so the next click
  // falls through to the bet modal.
  if (session.lastBetExpression) {
    const resolved = await resolveBet(session.lastBetExpression, user.id, {
      requireBalance: false, // balance check happens after multiplying by lines
    });
    const totalCost = resolved.ok ? resolved.amount * session.lastLines : 0;
    const balance = (await db.get(`${user.id}.balance`)) ?? 0;

    if (!resolved.ok || resolved.amount < 1 || totalCost > balance) {
      session.lastBet = 0;
      session.lastBetExpression = null;
      const reason = !resolved.ok
        ? resolved.reason
        : `\`${session.lastBetExpression || ""}\` × ${session.lastLines} = ${totalCost.toLocaleString("en-US")} ${CURRENCY_NAME}, but you only have ${balance.toLocaleString("en-US")}.`;
      if (session.lastEphemeralInteraction) {
        session.lastEphemeralInteraction.deleteReply().catch(() => {});
      }
      await buttonInt.reply({
        embeds: [buildErrorEmbed(user, client, `${reason} Click **Spin** again to enter a new bet.`)],
        ephemeral: true,
      });
      session.lastEphemeralInteraction = buttonInt;
      return;
    }

    session.lastBet = resolved.amount;
    return spinWithSettings(buttonInt, session, client, channel, user, resolved.amount, session.lastLines, /* deferUpdate */ true);
  }

  // No saved bet → open the combined bet+lines modal.
  const result = await openBetModal(buttonInt, {
    title: "Place your slots bet",
    placeholder: "e.g. 100, half, max",
    extras: [linesInputSpec(session.lastLines)],
  });
  if (!result) return;
  const { amount, expression, submit } = result;

  const lines = parseLinesField(submit);
  if (lines === null) {
    return submit.reply({ embeds: [buildErrorEmbed(user, client, `Paylines must be a whole number between 1 and ${SLOTS_MAX_LINES}.`)], ephemeral: true });
  }

  session.lastBet = amount;
  session.lastBetExpression = expression;
  session.lastLines = lines;
  await persistPreferences(user.id, expression, lines);
  return spinWithSettings(submit, session, client, channel, user, amount, lines, /* deferUpdate */ true);
}

// Shared spec for the lines text input. Discord modals only support length
// validation natively, so we constrain to the number of digits SLOTS_MAX_LINES
// occupies — any in-range value fits, any out-of-range value with too many
// digits is rejected by Discord before submit. Range/parse validation still
// runs server-side in parseLinesField below.
function linesInputSpec(currentLines) {
  const maxDigits = String(SLOTS_MAX_LINES).length;
  return {
    customId: "lines",
    label: `Paylines (1-${SLOTS_MAX_LINES})`,
    placeholder: `1-${SLOTS_MAX_LINES}`,
    value: String(Math.min(Math.max(currentLines || 1, 1), SLOTS_MAX_LINES)),
    minLength: 1,
    maxLength: maxDigits,
    required: true,
  };
}

function parseLinesField(submit) {
  const raw = submit.fields.getTextInputValue("lines").trim();
  const lines = parseInt(raw, 10);
  if (isNaN(lines) || lines < 1 || lines > SLOTS_MAX_LINES || String(lines) !== raw) return null;
  return lines;
}

async function spinWithSettings(interaction, session, client, channel, user, bet, lines, deferUpdate) {
  const current = client.slotsPanels.get(session.key);
  if (!current || current.status !== "waiting") {
    return interaction.reply({ embeds: [buildErrorEmbed(user, client, "Your slots panel is no longer available.")], ephemeral: true });
  }

  if (bet % 1 !== 0 || bet < 1) {
    return interaction.reply({ embeds: [buildErrorEmbed(user, client, `You must bet a positive whole number of ${CURRENCY_NAME}!`)], ephemeral: true });
  }
  const safeLines = Math.min(Math.max(Math.trunc(lines) || 1, 1), SLOTS_MAX_LINES);
  const totalCost = bet * safeLines;

  const debited = await withUserLock(user.id, async () => {
    const bal = await db.get(`${user.id}.balance`) ?? 0;
    if (bal < totalCost) return false;
    await db.sub(`${user.id}.balance`, totalCost);
    return true;
  });
  if (!debited) {
    return interaction.reply({ embeds: [buildErrorEmbed(user, client, `You don't have enough ${CURRENCY_NAME}! Need **${totalCost.toLocaleString("en-US")}** for this spin.`)], ephemeral: true });
  }

  current.status = "spinning";
  current.lastBet = bet;
  current.lastLines = safeLines;

  if (deferUpdate) {
    try { await interaction.deferUpdate(); } catch (_) {}
  }

  const msg = await channel.messages.fetch(current.messageId).catch(() => null);
  if (msg) {
    try { await msg.edit({ components: buildDisabledPanelComponents() }); } catch (_) {}
  }

  // Snapshot stats + balance so we can attribute per-round outcomes to the
  // session without modifying playSlots' return signature.
  const balanceBefore = (await db.get(`${user.id}.balance`) ?? 0) + totalCost; // pre-debit
  const statsBefore = {
    wins: (await db.get(`${user.id}.stats.slots.wins`)) ?? 0,
    losses: (await db.get(`${user.id}.stats.slots.losses`)) ?? 0,
    jackpots: (await db.get(`${user.id}.stats.slots.jackpots`)) ?? 0,
  };

  try {
    // playSlots handles the jackpot contribution internally for paid spins.
    await playSlots(interaction, bet, user, { lines: safeLines });
  } catch (err) {
    logger.error(`[slots] playSlots error: ${err && err.stack || err}`);
  }

  const balanceAfter = await db.get(`${user.id}.balance`) ?? 0;
  const statsAfter = {
    wins: (await db.get(`${user.id}.stats.slots.wins`)) ?? 0,
    losses: (await db.get(`${user.id}.stats.slots.losses`)) ?? 0,
    jackpots: (await db.get(`${user.id}.stats.slots.jackpots`)) ?? 0,
  };

  const winDelta = statsAfter.wins - statsBefore.wins;
  const lossDelta = statsAfter.losses - statsBefore.losses;
  const jackpotDelta = statsAfter.jackpots - statsBefore.jackpots;
  const profit = balanceAfter - balanceBefore;
  const returned = profit + totalCost; // winnings credited this round

  current.rounds += 1;
  current.spins += winDelta + lossDelta; // bonus spins included
  current.wins += winDelta;
  current.losses += lossDelta;
  current.jackpots += jackpotDelta;
  if (winDelta + lossDelta > 1) current.bonusesTriggered += 1;
  current.totalWagered += totalCost;
  current.totalReturned += Math.max(0, returned);
  if (profit > current.biggestWin) current.biggestWin = profit;
  if (-profit > current.biggestLoss) current.biggestLoss = -profit;

  // Only the lines changed inside spinWithSettings — bet expression is
  // persisted by the caller (handleSpin) at the modal-submit moment.
  await persistPreferences(user.id, undefined, safeLines);
  await finishSpin(client, msg, current, channel);
}

async function finishSpin(client, message, session, channel) {
  if (!client.slotsPanels.has(session.key)) return;
  session.status = "waiting";

  const user = await channel.guild.members.fetch(session.userId).then(m => m.user).catch(() => null);
  const balance = user ? (await db.get(`${session.userId}.balance`) ?? 0) : 0;

  // playSlots leaves the message showing the result image + per-spin embed.
  // We only restore hub buttons; embed and image stay as-is so the player can
  // still see the spin outcome alongside the controls.
  if (!message) return;
  try {
    await message.edit({ components: buildPanelComponents() });
  } catch (err) {
    logger.error(`[slots] finishSpin edit failed: ${err}`);
  }

  attachSessionCollector(client, message, session, channel);
}

async function handleChangeBet(buttonInt, session, client) {
  const user = buttonInt.user;
  const result = await openBetModal(buttonInt, {
    title: "Change slots bet",
    placeholder: "e.g. 100, half, max",
    // Pre-fill with the cached expression (e.g. `max * 0.2`) when present
    // so dynamic bets stay editable as-typed instead of becoming a literal.
    defaultAmount: session.lastBetExpression || (session.lastBet > 0 ? String(session.lastBet) : undefined),
  });
  if (!result) return;
  const { amount, expression, submit } = result;

  const current = client.slotsPanels.get(session.key);
  if (!current || current.status === "ended") {
    return submit.reply({ embeds: [buildErrorEmbed(user, client, "Your slots panel is no longer active.")], ephemeral: true });
  }
  current.lastBet = amount;
  current.lastBetExpression = expression;
  await persistPreferences(user.id, expression, null);

  if (current.lastEphemeralInteraction) {
    current.lastEphemeralInteraction.deleteReply().catch(() => {});
  }
  await submit.reply({
    embeds: [new EmbedBuilder()
      .setColor(0x0f4c25)
      .setDescription(`Bet updated to **${amount.toLocaleString("en-US")}** ${CURRENCY_NAME}. Click **Spin** to play.`)
      .setTimestamp()],
    ephemeral: true,
  });
  current.lastEphemeralInteraction = submit;
}

async function handleChangeLines(buttonInt, session, client) {
  const user = buttonInt.user;
  const modalId = `slots_lines_${buttonInt.id}`;
  const spec = linesInputSpec(session.lastLines);
  const input = new TextInputBuilder()
    .setCustomId(spec.customId)
    .setLabel(spec.label)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(spec.placeholder)
    .setRequired(true)
    .setMinLength(spec.minLength)
    .setMaxLength(spec.maxLength)
    .setValue(spec.value);
  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle("Change paylines")
    .addComponents(new ActionRowBuilder().addComponents(input));
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

  const lines = parseLinesField(submit);
  if (lines === null) {
    return submit.reply({ embeds: [buildErrorEmbed(user, client, `Paylines must be a whole number between 1 and ${SLOTS_MAX_LINES}.`)], ephemeral: true });
  }

  const current = client.slotsPanels.get(session.key);
  if (!current || current.status === "ended") {
    return submit.reply({ embeds: [buildErrorEmbed(user, client, "Your slots panel is no longer active.")], ephemeral: true });
  }
  current.lastLines = lines;
  await persistPreferences(user.id, null, lines);

  if (current.lastEphemeralInteraction) {
    current.lastEphemeralInteraction.deleteReply().catch(() => {});
  }
  await submit.reply({
    embeds: [new EmbedBuilder()
      .setColor(0x0f4c25)
      .setDescription(`Active paylines updated to **${lines}**. Click **Spin** to play.`)
      .setTimestamp()],
    ephemeral: true,
  });
  current.lastEphemeralInteraction = submit;
}

async function handlePaytable(buttonInt, client) {
  const { embed, attachment } = await buildPaytablePayload(buttonInt.user, client);
  return buttonInt.reply({ embeds: [embed], files: [attachment], ephemeral: true });
}

// ─── command entry point ─────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName("slots")
    .setDescription(`Play a game of slots for ${CURRENCY_NAME}.`)
    .addSubcommand(s => s
      .setName("spin")
      .setDescription("Open a persistent slots panel in this channel.")
      .addStringOption(o => o
        .setName("bet")
        .setDescription("The amount to bet (e.g. 100, half, max / 2).")
        .setRequired(false))
      .addIntegerOption(o => o
        .setName("lines")
        .setDescription(`The number of active paylines (1-${SLOTS_MAX_LINES}).`)
        .setMinValue(1)
        .setMaxValue(SLOTS_MAX_LINES)
        .setRequired(false)))
    .addSubcommand(s => s
      .setName("paytable")
      .setDescription("View the paytable for the slots."))
    .addSubcommand(s => s
      .setName("daily")
      .setDescription("Use your daily free spins.")),

  async execute(interaction) {
    const user = interaction.user;
    const client = interaction.client;
    const sub = interaction.options.getSubcommand();

    const dbUser = await db.get(user.id);
    if (!dbUser) {
      logger.warn(`No database entry for user ${user.username} (${user.id}), creating one...`);
      await addNewDBUser(user);
    }
    const dbUserFresh = await db.get(user.id);

    if (sub === "paytable") {
      return generatePaytable(interaction);
    }

    if (sub === "daily") {
      if ((dbUserFresh?.cooldowns?.freespins || 0) > Date.now()) {
        const nextAvailable = dbUserFresh.cooldowns.freespins;
        logger.debug(`User ${user.username} (${user.id}) daily free spin cooldown ends at ${nextAvailable}`);
        return interaction.reply({
          embeds: [buildErrorEmbed(user, client, `You have already used your daily free spins! Next available **${await formatTimeLeft(nextAvailable)}**.`)],
          ephemeral: true,
        });
      }
      logger.debug(`User ${user.username} (${user.id}) is using their daily free spins.`);
      await db.set(`${user.id}.cooldowns.freespins`, Date.now() + SLOTS_DAILY_COOLDOWN);
      await interaction.deferReply();
      return playSlots(interaction, 0, user, { lines: SLOTS_DAILY_LINES });
    }

    if (sub === "spin") {
      const betOption = interaction.options.getString("bet");
      const linesOption = interaction.options.getInteger("lines");

      // Lines-only override: persist before opening the panel so its
      // initial render uses the new value.
      if (!betOption && typeof linesOption === "number") {
        await persistPreferences(user.id, undefined, linesOption);
      }

      if (betOption) {
        return spinFromSlash(interaction, user, client, betOption, linesOption);
      }
      return openSlotsPanel(interaction, user, client);
    }
  },
};

// Fast path for `/slots spin bet:X [lines:Y]` — overwrites saved bet/lines,
// opens the panel message, runs the spin immediately, and leaves the hub
// buttons in place for follow-up spins. Mirrors blackjack's `/blackjack bet:X`
// fast path.
async function spinFromSlash(interaction, user, client, betExpression, linesOption) {
  const key = sessionKey(interaction.channelId, user.id);
  const existing = client.slotsPanels.get(key);

  // Power-user reuse: if a panel already exists and is idle, treat
  // `/slots spin bet:X` as if the user clicked Spin on that panel — the
  // spin animation renders on the existing panel message.
  if (existing && existing.status === "waiting") {
    return spinOnExistingPanel(interaction, existing, client, user, betExpression, linesOption);
  }
  if (existing && existing.status !== "ended") {
    if (existing.lastEphemeralInteraction) {
      existing.lastEphemeralInteraction.deleteReply().catch(() => {});
    }
    await interaction.reply({
      embeds: [buildErrorEmbed(user, client, "Your slots panel is mid-spin. Wait for it to finish.")],
      ephemeral: true,
    });
    existing.lastEphemeralInteraction = interaction;
    return;
  }

  const dbUser = (await db.get(user.id)) || {};
  const safeLines = typeof linesOption === "number"
    ? Math.min(Math.max(linesOption, 1), SLOTS_MAX_LINES)
    : Math.min(Math.max(dbUser.slots?.lastLines ?? 1, 1), SLOTS_MAX_LINES);

  const resolved = await resolveBet(betExpression, user.id);
  if (!resolved.ok) {
    return interaction.reply({ embeds: [buildErrorEmbed(user, client, resolved.reason)], ephemeral: true });
  }
  const totalCost = resolved.amount * safeLines;
  const balance = dbUser.balance ?? 0;
  if (totalCost > balance) {
    return interaction.reply({
      embeds: [buildErrorEmbed(user, client, `Need **${totalCost.toLocaleString("en-US")}** ${CURRENCY_NAME} for this spin (${resolved.amount.toLocaleString("en-US")} × ${safeLines}); you have **${balance.toLocaleString("en-US")}**.`)],
      ephemeral: true,
    });
  }

  // Overwrite saved defaults (expression + lines) so they survive panel close.
  await persistPreferences(user.id, betExpression.trim(), safeLines);

  await interaction.deferReply();
  const message = await interaction.fetchReply();

  const session = createSession(
    user.id, interaction.channelId, key, message.id,
    resolved.amount, safeLines, balance, betExpression.trim(),
  );
  client.slotsPanels.set(key, session);

  return spinWithSettings(
    interaction, session, client, interaction.channel, user,
    resolved.amount, safeLines, /* deferUpdate */ false,
  );
}

// Wraps the slash interaction so `playSlots` and `spinWithSettings` (which
// were built around a single-message `interaction.editReply` flow) render on
// the existing panel message instead. Only the surface they actually touch
// — `editReply` / `reply` / `followUp` / `client` / `user` — is proxied;
// `deferUpdate` is a no-op since slash commands can't ack via component-style
// updates.
function buildPanelProxy(realInteraction, panelMessage, channel) {
  return {
    client: realInteraction.client,
    user: realInteraction.user,
    channel,
    replied: false,
    deferred: false,
    deferUpdate: async () => { /* no-op for slash */ },
    editReply: (opts) => panelMessage.edit(opts),
    reply: (opts) => realInteraction.followUp({ ...opts, ephemeral: opts.ephemeral !== false }),
    followUp: (opts) => channel.send(opts),
  };
}

// Slash-with-bet against an already-open panel: validate, debit-via-spin,
// ephemerally confirm the slash, then run the spin on the existing panel
// message via a proxy interaction. Net effect matches clicking Spin on the
// panel — animation + result land on the same message as the panel.
async function spinOnExistingPanel(interaction, session, client, user, betExpression, linesOption) {
  const dbUser = (await db.get(user.id)) || {};
  const safeLines = typeof linesOption === "number"
    ? Math.min(Math.max(linesOption, 1), SLOTS_MAX_LINES)
    : (session.lastLines || Math.min(Math.max(dbUser.slots?.lastLines ?? 1, 1), SLOTS_MAX_LINES));

  const resolved = await resolveBet(betExpression, user.id);
  if (!resolved.ok) {
    return interaction.reply({ embeds: [buildErrorEmbed(user, client, resolved.reason)], ephemeral: true });
  }
  const totalCost = resolved.amount * safeLines;
  const balance = dbUser.balance ?? 0;
  if (totalCost > balance) {
    return interaction.reply({
      embeds: [buildErrorEmbed(user, client, `Need **${totalCost.toLocaleString("en-US")}** ${CURRENCY_NAME} for this spin (${resolved.amount.toLocaleString("en-US")} × ${safeLines}); you have **${balance.toLocaleString("en-US")}**.`)],
      ephemeral: true,
    });
  }

  await persistPreferences(user.id, betExpression.trim(), safeLines);
  session.lastBetExpression = betExpression.trim();
  session.lastLines = safeLines;

  let panelMessage;
  try {
    panelMessage = await interaction.channel.messages.fetch(session.messageId);
  } catch (err) {
    return interaction.reply({
      embeds: [buildErrorEmbed(user, client, "Couldn't find your panel message — it may have been deleted. Use `/slots spin` to open a fresh one.")],
      ephemeral: true,
    });
  }

  if (session.lastEphemeralInteraction) {
    session.lastEphemeralInteraction.deleteReply().catch(() => {});
  }
  await interaction.reply({
    content: `Spinning **${resolved.amount.toLocaleString("en-US")}** × **${safeLines}** on your existing panel…`,
    ephemeral: true,
  });
  session.lastEphemeralInteraction = interaction;

  const proxy = buildPanelProxy(interaction, panelMessage, interaction.channel);
  try {
    await spinWithSettings(
      proxy, session, client, interaction.channel, user,
      resolved.amount, safeLines, /* deferUpdate */ false,
    );
  } catch (err) {
    logger.error(`[slots] spinOnExistingPanel error: ${err && err.stack || err}`);
    session.status = "waiting";
  }
}

