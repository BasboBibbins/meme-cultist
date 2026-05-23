const { EmbedBuilder } = require("discord.js");
const { db } = require("../database");
const { CURRENCY_NAME, SLOTS_NEAR_MISS_CHANCE, SLOTS_BONUS_FREE_SPINS, SLOTS_BONUS_MULTIPLIER, SLOTS_DAILY_FREE_SPINS, SLOTS_DAILY_BET, SLOTS_FULLSCREEN_CHANCE, SLOTS_FULLSCREEN_MULTIPLIER } = require("../config.js");
const wait = require("node:timers/promises").setTimeout;
const logger = require("../utils/logger");
const { getJackpot, contributeToJackpot, winJackpot, isJackpotEligible, getJackpotDisplay, MIN_BET } = require("./jackpot");
const { drawSlotMachine, drawSpinAnimation, drawPaytable, PAYLINES } = require("./slotsCanvas");
const { getTheme } = require("./slotsThemes");
const { getEquippedTheme } = require("../themes/manager");
const { recordGameResult } = require("./gameResults");

const SYMBOL_NAMES = ["Apple", "Tangerine", "Lemon", "Grapes", "Cherry", "Bell", "BAR", "7", "Wild", "Scatter"];

// Symbol definitions: index, weights, multipliers
const SYMBOLS = [
  { index: 0, emoji: ":apple:",    weight: 20, multiplier: 2,   partial: 0.75 },
  { index: 1, emoji: ":tangerine:", weight: 18, multiplier: 3,   partial: 1.5 },
  { index: 2, emoji: ":lemon:",     weight: 16, multiplier: 5,   partial: 2 },
  { index: 3, emoji: ":grapes:",    weight: 12, multiplier: 8,   partial: 3 },
  { index: 4, emoji: ":cherries:",  weight: 10, multiplier: 10,  partial: 4 },
  { index: 5, emoji: ":bell:",      weight: 8,  multiplier: 15,  partial: 6 },
  { index: 6, emoji: "BAR",         weight: 4,  multiplier: 35,  partial: 10 },
  { index: 7, emoji: "7",           weight: 2,  multiplier: 75,  partial: 20 },
  { index: 8, emoji: "WILD",        weight: 4,  multiplier: 0,   partial: 0 },
  { index: 9, emoji: "SCATTER",     weight: 4,  multiplier: 0,   partial: 0 },
];

const WILD_INDEX = 8;
const SCATTER_INDEX = 9;

const MAX_RETRIES = 4;

// Build weighted pool for RNG
const weightedPool = [];
for (const sym of SYMBOLS) {
  for (let i = 0; i < sym.weight; i++) {
    weightedPool.push(sym.index);
  }
}

function pickSymbol() {
  return weightedPool[Math.floor(Math.random() * weightedPool.length)];
}

/**
 * Retry a Discord API call with exponential backoff.
 * Delays: 1s, 2s, 4s, 8s (for up to MAX_RETRIES attempts).
 * Returns true on success, false on exhausted retries.
 */
async function retryDiscord(fn, label) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await fn();
      return true;
    } catch (err) {
      // Unknown interaction (10062) = token expired, not retryable
      if (err.code === 10062) {
        logger.error(`[slots] ${label}: Interaction expired (10062), cannot recover.`);
        return false;
      }
      if (attempt < MAX_RETRIES) {
        const delay = 1000 * Math.pow(2, attempt);
        logger.warn(`[slots] ${label}: Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed (${err.code || err.message}), retrying in ${delay}ms...`);
        await wait(delay);
      } else {
        logger.error(`[slots] ${label}: All ${MAX_RETRIES + 1} attempts failed. Last error: ${err.message}`);
        return false;
      }
    }
  }
  return false;
}

/**
 * Generate a 3x3 grid of symbol indices using weighted RNG.
 */
function spinGrid() {
  const grid = [];
  for (let row = 0; row < 3; row++) {
    grid.push([pickSymbol(), pickSymbol(), pickSymbol()]);
  }
  return grid;
}

/**
 * Evaluate all active paylines for wins.
 * Returns array of { line, matchSymbol, count, multiplier, isWild }
 */
function evaluateGrid(grid, activeLines) {
  const results = [];

  for (let lineIdx = 0; lineIdx < activeLines; lineIdx++) {
    const positions = PAYLINES[lineIdx];
    const lineSymbols = positions.map(([r, c]) => grid[r][c]);

    let matchSym = null;
    for (const s of lineSymbols) {
      if (s !== WILD_INDEX && s !== SCATTER_INDEX) {
        matchSym = s;
        break;
      }
    }

    // 3-WILD line is the new progressive jackpot trigger. Payout (pot vs
    // flat consolation) is decided in executeSpin once the bet is in scope.
    if (matchSym === null) {
      if (lineSymbols.every(s => s === WILD_INDEX)) {
        results.push({
          line: lineIdx,
          matchSymbol: WILD_INDEX,
          count: 3,
          multiplier: 0,
          isWild: true,
          isJackpotTrigger: true,
        });
      }
      continue;
    }

    let count = 0;
    let hasWild = false;
    for (const s of lineSymbols) {
      if (s === matchSym || s === WILD_INDEX) {
        count++;
        if (s === WILD_INDEX) hasWild = true;
      } else {
        break;
      }
    }

    if (count >= 2) {
      const sym = SYMBOLS[matchSym];
      const multiplier = count === 3 ? sym.multiplier : sym.partial;
      if (multiplier > 0) {
        results.push({
          line: lineIdx,
          matchSymbol: matchSym,
          count,
          multiplier,
          isWild: hasWild,
        });
      }
    }
  }

  return results;
}

/**
 * Count scatter symbols anywhere on the grid.
 */
function countScatters(grid) {
  let count = 0;
  for (const row of grid) {
    for (const sym of row) {
      if (sym === SCATTER_INDEX) count++;
    }
  }
  return count;
}

/**
 * Near-miss nudge: if no win and RNG triggers, modify one symbol to be close to a high-value match.
 */
function applyNearMiss(grid, activeLines) {
  if (Math.random() >= SLOTS_NEAR_MISS_CHANCE) return grid;

  for (let lineIdx = 0; lineIdx < activeLines; lineIdx++) {
    const positions = PAYLINES[lineIdx];
    const lineSymbols = positions.map(([r, c]) => grid[r][c]);

    const first = lineSymbols[0];
    if (first === WILD_INDEX || first === SCATTER_INDEX) continue;
    if (first === lineSymbols[1] || lineSymbols[1] === WILD_INDEX) {
      const third = lineSymbols[2];
      if (third !== first && third !== WILD_INDEX) {
        const highValue = [5, 6, 7];
        const nudgeTarget = highValue.includes(first) ? first : highValue[Math.floor(Math.random() * highValue.length)];
        const [r0, c0] = positions[0];
        const [r1, c1] = positions[1];
        grid[r0][c0] = nudgeTarget;
        grid[r1][c1] = nudgeTarget;
        return grid;
      }
    }
  }

  return grid;
}

/**
 * Execute a single spin: generate grid, calculate wins, show animation + result.
 * Returns { totalWin, winResults, isJackpot, jackpotAmount, triggersBonus, scatterCount, failed }
 */
async function executeSpin(interaction, user, options = {}, themeOverride = null) {
  const {
    actualBet,
    lines = 1,
    bonusMultiplier = 1,
    isBonus = false,
    isFreePlay = false,
    spinLabel = "",
  } = options;

  const [jackpotDisplayStr, themeIdRaw] = await Promise.all([
    getJackpotDisplay(),
    themeOverride ? Promise.resolve(null) : getEquippedTheme(user.id),
  ]);
  const theme = themeOverride || getTheme(themeIdRaw);

  logger.debug(`Slots spin: ${actualBet} ${CURRENCY_NAME} x ${lines} lines ${spinLabel}for ${user.displayName} [theme: ${theme.id}]`);

  // Full-screen mega-win pre-roll (paid spins only). When triggered, all 9
  // cells become the same premium-tier symbol and the normal grid/scatter
  // path is bypassed — payout is bet * lines * SLOTS_FULLSCREEN_MULTIPLIER.
  let grid;
  let winResults;
  let scatterCount = 0;
  let triggersBonus = false;
  let isFullScreen = false;

  if (!isFreePlay && !isBonus && Math.random() < SLOTS_FULLSCREEN_CHANCE) {
    // Eligible pool excludes apple/tan (too common to feel premium) and
    // WILD/SCATTER (would collide with jackpot/bonus mechanics).
    const fullScreenPool = [2, 3, 4, 5, 6, 7];
    const symbolIndex = fullScreenPool[Math.floor(Math.random() * fullScreenPool.length)];
    grid = [
      [symbolIndex, symbolIndex, symbolIndex],
      [symbolIndex, symbolIndex, symbolIndex],
      [symbolIndex, symbolIndex, symbolIndex],
    ];
    winResults = [{
      line: -1,
      matchSymbol: symbolIndex,
      count: 9,
      multiplier: SLOTS_FULLSCREEN_MULTIPLIER * lines,
      isWild: false,
      isFullScreen: true,
    }];
    isFullScreen = true;
    logger.debug(`Slots full-screen mega-win triggered for ${user.displayName}: symbol ${symbolIndex}`);
  } else {
    grid = spinGrid();
    winResults = evaluateGrid(grid, lines);
    scatterCount = countScatters(grid);
    triggersBonus = scatterCount >= 3 && !isBonus;

    // Apply near-miss if no wins
    if (winResults.length === 0 && !triggersBonus) {
      grid = applyNearMiss(grid, lines);
      winResults = evaluateGrid(grid, lines);
    }
  }

  // Calculate total winnings
  let totalWin = 0;
  let isJackpot = false;
  let jackpotAmount = 0;

  for (const win of winResults) {
    let winAmount = Math.floor(actualBet * win.multiplier * bonusMultiplier);

    if (win.isJackpotTrigger) {
      const eligible = (!isFreePlay) && isJackpotEligible(actualBet);
      if (eligible) {
        const jackpotResult = await winJackpot(user.id, user.displayName);
        jackpotAmount = jackpotResult.amount;
        winAmount = jackpotAmount;
        isJackpot = true;
      } else {
        // Consolation payout for sub-min-bet players who hit 3-WILD —
        // mirrors the old 7-3-match ineligible fallback so the rare
        // visual still pays out something memorable.
        winAmount = Math.floor(actualBet * 100);
      }
    }

    totalWin += winAmount;
  }

  // Update balance and stats before generating images (so balance displayed is correct)
  const totalCost = isFreePlay || isBonus ? 0 : actualBet * lines;
  if (totalWin > 0) {
    await db.add(`${user.id}.balance`, totalWin);
    await db.add(`${user.id}.stats.slots.wins`, 1);
    if (totalWin > (await db.get(`${user.id}.stats.slots.biggestWin`) || 0)) {
      await db.set(`${user.id}.stats.slots.biggestWin`, totalWin);
    }
    if (isJackpot) {
      await db.add(`${user.id}.stats.slots.jackpots`, 1);
    }
    await db.add(`${user.id}.stats.slots.profit`, totalWin - totalCost);
  } else if (!isFreePlay && !isBonus) {
    await db.add(`${user.id}.stats.slots.losses`, 1);
    const currentLoss = actualBet * lines;
    if (currentLoss > (await db.get(`${user.id}.stats.slots.biggestLoss`) || 0)) {
      await db.set(`${user.id}.stats.slots.biggestLoss`, currentLoss);
    }
    await db.sub(`${user.id}.stats.slots.profit`, currentLoss);
  }

  const currentBalance = await db.get(`${user.id}.balance`);

  // Send spinning animation GIF
  const spinAttachment = await drawSpinAnimation(grid, {
    jackpotDisplay: jackpotDisplayStr,
    activeLines: lines,
    bet: actualBet,
    isBonus,
    isFreePlay,
    theme,
  });

  let ok = await retryDiscord(
    () => interaction.editReply({ files: [spinAttachment], embeds: [] }),
    `spin animation ${spinLabel}`
  );
  if (!ok) {
    return { totalWin: 0, winResults: [], isJackpot: false, jackpotAmount: 0, triggersBonus: false, scatterCount: 0, failed: true };
  }

  // Brief pause to let user see the spin animation before result replaces it
  await wait(1500);

  // Draw static result image (PNG with winning lines highlighted)
  const resultAttachment = await drawSlotMachine(grid, {
    jackpotDisplay: isJackpot ? await getJackpotDisplay() : jackpotDisplayStr,
    activeLines: lines,
    bet: actualBet,
    totalWin,
    balance: currentBalance,
    winResults,
    isBonus,
    isFreePlay,
    bonusSpinsLeft: 0,
    theme,
  });

  // Build per-spin embed
  const embed = new EmbedBuilder()
    .setAuthor({ name: `${user.displayName} | Slots`, iconURL: user.displayAvatarURL({ dynamic: true }) })
    .setFooter({ text: `${interaction.client.user.username} | Version ${require("../package.json").version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
    .setTimestamp();

  if (isJackpot) {
    embed.setColor(0xFFD700);
    embed.setTitle(`\u{1F3B0} JACKPOT!!! \u{1F3B0}${isFreePlay ? " (ON A FREE SPIN?!?!)" : ""}`);
    embed.setDescription(`You won the **Progressive Jackpot** of **${jackpotAmount.toLocaleString()}** ${CURRENCY_NAME}!\nBalance: **${currentBalance.toLocaleString()}** ${CURRENCY_NAME}`);
  } else if (isFullScreen) {
    const win = winResults[0];
    const sym = theme.symbols[win.matchSymbol] || SYMBOLS[win.matchSymbol];
    embed.setColor(0xAA00FF);
    embed.setTitle("\u{1F4AB} MEGA WIN!!! \u{1F4AB}");
    embed.setDescription(`Full screen of **${sym.label || sym.name}**! You won **${totalWin.toLocaleString()}** ${CURRENCY_NAME}!\nBalance: **${currentBalance.toLocaleString()}** ${CURRENCY_NAME}`);
  } else if (totalWin > 0) {
    embed.setColor(0x00FF00);
    embed.setTitle(`You won!${isFreePlay ? " (Free spin)" : ""}${isBonus ? ` (Bonus x${bonusMultiplier})` : ""}`);
    let desc = `You won **${totalWin.toLocaleString()}** ${CURRENCY_NAME}!`;
    for (const win of winResults) {
      const sym = theme.symbols[win.matchSymbol] || SYMBOLS[win.matchSymbol];
      desc += `\nLine ${win.line + 1}: ${win.count}x ${sym.label || sym.name}${win.isWild ? " (w/ Wild)" : ""} = ${Math.floor(actualBet * win.multiplier * bonusMultiplier).toLocaleString()} ${CURRENCY_NAME}`;
    }
    desc += `\nBalance: **${currentBalance.toLocaleString()}** ${CURRENCY_NAME}`;
    embed.setDescription(desc);
  } else {
    embed.setColor(0xFF0000);
    embed.setTitle(`You lost!${isFreePlay ? " (Free spin)" : ""}${isBonus ? " (Bonus)" : ""}`);
    let desc = `Balance: **${currentBalance.toLocaleString()}** ${CURRENCY_NAME}`;
    if (!isFreePlay && !isBonus && currentBalance <= 0) desc += "\nYou are now broke!";
    embed.setDescription(desc);
  }

  if (triggersBonus) {
    embed.addFields({
      name: "\u{2B50} BONUS TRIGGERED! \u{2B50}",
      value: `${scatterCount} Scatter symbols! You get **${SLOTS_BONUS_FREE_SPINS} free spins** at **${SLOTS_BONUS_MULTIPLIER}x** multiplier!`,
    });
  }

  // Send result image + embed
  ok = await retryDiscord(
    () => interaction.editReply({ files: [resultAttachment], embeds: [embed] }),
    `result image ${spinLabel}`
  );
  if (!ok) {
    return { totalWin, winResults, isJackpot, jackpotAmount, triggersBonus, scatterCount, failed: true };
  }

  // Jackpot announcement
  if (isJackpot) {
    await retryDiscord(
      () => interaction.followUp({
        content: `@everyone **${user.displayName}** just won the JACKPOT! \u{1F3B0} **${jackpotAmount.toLocaleString()}** ${CURRENCY_NAME}!`,
        allowedMentions: { parse: ["everyone"] },
      }),
      "jackpot announcement"
    );
  }

  try {
    recordGameResult({
      guildId: interaction.guildId || interaction.channel?.guildId || null,
      channelId: interaction.channelId || interaction.channel?.id,
      userId: user.id,
      game: "slots",
      result: {
        grid: grid.map(row => row.map(idx => SYMBOL_NAMES[idx] ?? idx)),
        winning_lines: winResults.map(w => ({
          line: w.line,
          symbol: SYMBOL_NAMES[w.matchSymbol] ?? w.matchSymbol,
          count: w.count,
          payout: Math.floor(actualBet * w.multiplier * bonusMultiplier),
          is_wild: w.isWild || false,
          is_jackpot: w.isJackpotTrigger || false,
          is_fullscreen: w.isFullScreen || false,
        })),
        bet_per_line: actualBet,
        active_lines: lines,
        total_cost: isFreePlay || isBonus ? 0 : actualBet * lines,
        total_payout: totalWin,
        net: totalWin - (isFreePlay || isBonus ? 0 : actualBet * lines),
        outcome: totalWin > 0 ? "win" : "loss",
        is_jackpot: isJackpot,
        jackpot_amount: jackpotAmount || null,
        is_fullscreen: isFullScreen,
        is_bonus: isBonus,
        is_free: isFreePlay,
        bonus_triggered: triggersBonus,
        scatter_count: scatterCount,
      },
    });
  } catch (_) {}

  return { totalWin, winResults, isJackpot, jackpotAmount, triggersBonus, scatterCount, failed: false };
}

/**
 * Build a summary embed for a multi-spin sequence (free spins or bonus).
 */
function buildSummaryEmbed(user, spinResults, label, interaction, theme) {
  const grandTotal = spinResults.reduce((sum, r) => sum + r.totalWin, 0);
  const totalSpins = spinResults.length;
  const winningSpins = spinResults.filter(r => r.totalWin > 0).length;

  const embed = new EmbedBuilder()
    .setAuthor({ name: `${user.displayName} | ${label} Summary`, iconURL: user.displayAvatarURL({ dynamic: true }) })
    .setColor(grandTotal > 0 ? 0x00FF00 : 0xFF0000)
    .setFooter({ text: `${interaction.client.user.username} | Version ${require("../package.json").version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
    .setTimestamp();

  let desc = "";
  for (let i = 0; i < spinResults.length; i++) {
    const r = spinResults[i];
    if (r.totalWin > 0) {
      let lineDetail = "";
      for (const win of r.winResults) {
        const sym = theme.symbols[win.matchSymbol] || SYMBOLS[win.matchSymbol];
        lineDetail += ` (${win.count}x ${sym.label || sym.name}${win.isWild ? " w/ Wild" : ""})`;
      }
      if (r.isJackpot) {
        desc += `**Spin ${i + 1}:** \u{1F3B0} **JACKPOT ${r.jackpotAmount.toLocaleString()}** ${CURRENCY_NAME}\n`;
      } else {
        desc += `**Spin ${i + 1}:** +**${r.totalWin.toLocaleString()}** ${CURRENCY_NAME}${lineDetail}\n`;
      }
    } else {
      desc += `**Spin ${i + 1}:** No win\n`;
    }
  }

  desc += `\n**Grand Total: ${grandTotal > 0 ? "+" : ""}${grandTotal.toLocaleString()} ${CURRENCY_NAME}** (${winningSpins}/${totalSpins} wins)`;

  embed.setTitle(`${label} Complete!`);
  embed.setDescription(desc);

  return embed;
}

/**
 * Run a bonus spin sequence and return collected results.
 */
async function runBonusSpins(interaction, actualBet, user, lines, theme) {
  const results = [];
  for (let i = 0; i < SLOTS_BONUS_FREE_SPINS; i++) {
    await wait(1500);
    const result = await executeSpin(interaction, user, {
      actualBet,
      lines,
      bonusMultiplier: SLOTS_BONUS_MULTIPLIER,
      isBonus: true,
      spinLabel: `(BONUS ${i + 1}/${SLOTS_BONUS_FREE_SPINS}) `,
    }, theme);
    results.push(result);
    if (result.failed) break;
  }
  return results;
}

/**
 * Main slot play function.
 * Expects interaction to already be deferred (via deferReply).
 */
async function playSlots(interaction, bet, user, options = {}) {
  const { lines = 1 } = options;

  const themeId = await getEquippedTheme(user.id);
  const theme = getTheme(themeId);

  const freePlay = bet === 0;
  const actualBet = freePlay ? SLOTS_DAILY_BET : bet;

  // --- Free play daily spins ---
  if (freePlay) {
    const totalFreeSpins = SLOTS_DAILY_FREE_SPINS;
    const spinResults = [];

    for (let i = 0; i < totalFreeSpins; i++) {
      if (i > 0) await wait(1500);
      const result = await executeSpin(interaction, user, {
        actualBet,
        lines,
        isFreePlay: true,
        spinLabel: `(FREE ${i + 1}/${totalFreeSpins}) `,
      }, theme);
      spinResults.push(result);
      if (result.failed) break;

      // Handle bonus trigger during free spins
      if (result.triggersBonus) {
        const bonusResults = await runBonusSpins(interaction, actualBet, user, lines, theme);
        // Show bonus summary inline
        if (bonusResults.length > 0 && !bonusResults[bonusResults.length - 1].failed) {
          const bonusSummary = buildSummaryEmbed(user, bonusResults, "Bonus Spins", interaction, theme);
          await retryDiscord(
            () => interaction.followUp({ embeds: [bonusSummary] }),
            "bonus summary during free spins"
          );
        }
      }
    }

    // Send free spins summary
    if (spinResults.length > 0 && !spinResults[spinResults.length - 1].failed) {
      const summary = buildSummaryEmbed(user, spinResults, "Daily Free Spins", interaction, theme);
      await retryDiscord(
        () => interaction.followUp({ embeds: [summary] }),
        "free spins summary"
      );
    }
    return;
  }

  // --- Regular paid spin ---
  if (!freePlay) {
    await contributeToJackpot(actualBet * lines);
  }

  const result = await executeSpin(interaction, user, {
    actualBet,
    lines,
    spinLabel: "",
  }, theme);

  if (result.failed) {
    await handleFailure(user, bet, lines);
    return;
  }

  // Handle bonus trigger from a paid spin
  if (result.triggersBonus) {
    const bonusResults = await runBonusSpins(interaction, actualBet, user, lines, theme);
    if (bonusResults.length > 0 && !bonusResults[bonusResults.length - 1].failed) {
      const summary = buildSummaryEmbed(user, bonusResults, "Bonus Spins", interaction, theme);
      await retryDiscord(
        () => interaction.followUp({ embeds: [summary] }),
        "bonus summary"
      );
    }
  }
}

/**
 * Handle unrecoverable Discord API failure: refund the bet and log.
 */
async function handleFailure(user, bet, lines) {
  if (bet > 0) {
    const refund = bet * lines;
    await db.add(`${user.id}.balance`, refund);
    logger.error(`[slots] Refunded ${refund} ${CURRENCY_NAME} to ${user.displayName} (${user.id}) due to Discord API failure.`);
  } else {
    logger.error(`[slots] Discord API failure for ${user.displayName} (${user.id}) on free spin (no refund needed).`);
  }
}

async function buildPaytablePayload(user, client) {
  const themeId = await getEquippedTheme(user.id);
  const theme = getTheme(themeId);
  const jackpotDisplayStr = await getJackpotDisplay();
  const attachment = await drawPaytable(jackpotDisplayStr, SYMBOLS, theme);
  const embed = new EmbedBuilder()
    .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
    .setColor(theme.colors.embedColor || 0x0f4c25)
    .setImage("attachment://paytable.png")
    .setFooter({ text: `${client.user.username} | Version ${require("../package.json").version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
    .setTimestamp();
  return { embed, attachment };
}

async function generatePaytable(interaction) {
  const { embed, attachment } = await buildPaytablePayload(interaction.user, interaction.client);
  return interaction.reply({ embeds: [embed], files: [attachment] });
}

module.exports = {
  generatePaytable,
  buildPaytablePayload,
  playSlots,
};
