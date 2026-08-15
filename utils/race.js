const { CONVO_MODEL, RACE_PLACE_MULTIPLIER, RACE_SHOW_MULTIPLIER } = require("../config.js");
const logger = require("./logger");
const llm = require("./llm");

const ADJECTIVES = [
  // Generic
  "Royal", "Noble", "Silver", "Golden", "Dark", "Swift", "Bold", "Wild", "Iron",
  "Midnight", "Crimson", "Blazing", "Ancient", "Sacred", "Mighty", "Phantom",
  "Eternal", "Raging", "Frozen", "Thunder", "Shadow",
  "Crusty", "Wobbly", "Sleepy", "Soggy", "Grumpy", "Chonky", "Dusty", "Sneaky",
  "Hangry", "Discount", "Cursed", "Broke", "Slightly", "Suspiciously",
  "Aggressively", "Mediocre", "Confused", "Retired", "Certified", 
  "Special", "Silence", "Fwenly", "Definitely-Not-A",
];

const ADJ_USE_PERCENT = 95; // percentage of time an adjective is used for a horse name. (default: 95) 

const NOUNS = [
  "Blade", "Crown", "Storm", "Lance", "Crest", "Star", "Comet", "Arrow",
  "Dancer", "Ruler", "Sovereign", "Champion", "Warrior", "Legend", "Eclipse",
  "Horizon", "Tempest", "Valor", "Spirit", "Fire",
  "Noodle", "Bucket", "Socks", "Muffin", "Goblin", "Potato", "Biscuit", "Waffle",
  "Accountant", "Conspiracy", "Refund", "Intern", "Napkin", "Horoscope",
  "Regret", "Situation", "Vibez", "Agenda", "Omen", "Opinion",
];

// add more nouns and adjectives stored in the .env

NOUNS.push(...(process.env.ADDITIONAL_NOUNS || "").split(",").map(s => s.trim()).filter(Boolean));
ADJECTIVES.push(...(process.env.ADDITIONAL_ADJECTIVES || "").split(",").map(s => s.trim()).filter(Boolean));

logger.debug(`\x1b[33m[Race]\x1b[0m Loaded ${ADJECTIVES.length} adjectives and ${NOUNS.length} nouns for horse name generation.`);

// Code blocks fall back to the system emoji font, so runners are separated by
// silhouette and hue. 🏇 🐴 🦌 collided with 🐎 in every font.
const EMOJIS = ["🐎", "🦄", "🦓", "🐢", "🐐", "🦩", "🎠", "⭐"];

const ODDS_LABELS = [
  { threshold: 0.25, label: "🟢 Favorite" },
  { threshold: 0.10, label: "🟡 Contender" },
  { threshold: 0.05, label: "🟠 Longshot" },
  { threshold: 0,    label: "🔴 Outsider" },
];

// Trails the lane: a medal is not reliably two monospace cells.
const RANK_LABELS = { "🥇": "🥇 1st", "🥈": "🥈 2nd", "🥉": "🥉 3rd" };
const MEDALS = ["🥇", "🥈", "🥉"];

function standingsFrom(positions) {
  return positions.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
}

// Headroom under Discord's 4096 cap for mention expansion.
const RESULTS_DESCRIPTION_LIMIT = 3900;
const MAX_RESULT_LINES = 12;
const MAX_BETTORS_PER_HORSE = 6;

function formatBetType(type) {
  const t = (type || "win").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Display names are user controlled and land in a markdown context.
function escapeMarkdown(text) {
  return String(text).replace(/([\\*_~`|])/g, "\\$1");
}

function summarizeBettors(results) {
  const byUser = new Map();

  for (const r of results) {
    if (!byUser.has(r.userId)) {
      byUser.set(r.userId, { userId: r.userId, bets: 0, wins: 0, staked: 0, returned: 0, only: null });
    }
    const entry = byUser.get(r.userId);
    entry.bets += 1;
    entry.staked += r.amount;
    if (r.won) {
      entry.wins += 1;
      entry.returned += r.winnings;
    }
    entry.only = entry.bets === 1 ? r : null;
  }

  return [...byUser.values()]
    .map(e => ({ ...e, net: e.returned - e.staked }))
    .sort((a, b) => b.net - a.net);
}

function buildResultsSection(bettors, horses, currencyName, maxLines = MAX_RESULT_LINES) {
  if (bettors.length === 0) return [];

  const lines = ["", "**Results:**"];
  const shown = bettors.slice(0, maxLines);

  for (const b of shown) {
    const amount = Math.abs(b.net).toLocaleString("en-US");

    if (b.only) {
      const horse = horses[b.only.horseIndex];
      const place = ["🥇", "🥈", "🥉"][b.only.horsePosition] ?? "";
      const type = formatBetType(b.only.betType);
      lines.push(b.only.won
        ? `${place}✅ <@${b.userId}> won **${b.only.winnings.toLocaleString("en-US")}** ${currencyName} on Horse ${horse.number} (${type})`
        : `❌ <@${b.userId}> lost **${b.only.amount.toLocaleString("en-US")}** ${currencyName} on Horse ${horse.number} (${type})`);
      continue;
    }

    const record = `${b.wins}/${b.bets} bets`;
    if (b.net > 0) lines.push(`✅ <@${b.userId}> won **${amount}** ${currencyName} net on ${record}`);
    else if (b.net < 0) lines.push(`❌ <@${b.userId}> lost **${amount}** ${currencyName} net on ${record}`);
    else lines.push(`➖ <@${b.userId}> broke even on ${record}`);
  }

  const hidden = bettors.length - shown.length;
  if (hidden > 0) {
    const staked = bettors.slice(maxLines).reduce((sum, b) => sum + b.staked, 0);
    lines.push(`*…and ${hidden} more bettor${hidden === 1 ? "" : "s"} staking ${staked.toLocaleString("en-US")} ${currencyName}.*`);
  }

  return lines;
}

// Trims from the bottom so a busy race can never fail to post.
function fitDescription(headLines, sectionLines, limit = RESULTS_DESCRIPTION_LIMIT) {
  const section = [...sectionLines];
  let dropped = 0;

  const render = () => [...headLines, ...section].join("\n");

  while (render().length > limit && section.length > 2) {
    section.pop();
    dropped += 1;
  }

  if (dropped > 0) {
    section.push(`*…and ${dropped} more result${dropped === 1 ? "" : "s"} not shown.*`);
    while (render().length > limit && section.length > 2) {
      section.splice(section.length - 2, 1);
    }
  }

  return render();
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function getOddsLabel(probability) {
  return ODDS_LABELS.find(o => probability >= o.threshold)?.label ?? "🔴 Outsider";
}

function calculatePayout(betAmount, displayOdds, houseEdge = 0.10, betType = "win") {
  let odds;
  switch (betType) {
    case "place":
      odds = (displayOdds - 1) * RACE_PLACE_MULTIPLIER + 1;
      break;
    case "show":
      odds = (displayOdds - 1) * RACE_SHOW_MULTIPLIER + 1;
      break;
    case "win":
    default:
      odds = displayOdds;
      break;
  }
  return Math.floor(betAmount * odds * (1 - houseEdge));
}

function generateHorses() {
  const adj  = shuffleArray([...ADJECTIVES]);
  const noun = shuffleArray([...NOUNS]);

  const forms = Array.from({ length: 8 }, () => Math.floor(Math.random() * 91) + 10);
  const totalForm = forms.reduce((sum, f) => sum + f, 0);

  const numbers = shuffleArray([1, 2, 3, 4, 5, 6, 7, 8]);

  const horses = Array.from({ length: 8 }, (_, i) => {
    const form = forms[i];
    const probability = form / totalForm;
    const displayOdds = Math.min(25, Math.round((1 / probability) * 10) / 10);
    const usesAdj = Math.random() < (ADJ_USE_PERCENT / 100);

    return {
      number: numbers[i],
      name: usesAdj ? `${adj[i]} ${noun[i]}` : noun[i],
      emoji: EMOJIS[i],
      style: PACE_STYLES[Math.floor(Math.random() * PACE_STYLES.length)],
      form,
      probability,
      displayOdds,
    };
  });

  horses.sort((a, b) => a.number - b.number);

  return horses;
}

function determineWinner(horses) {
  const roll = Math.random();
  let cumulative = 0;

  for (const horse of horses) {
    cumulative += horse.probability;
    if (roll < cumulative) return horse;
  }

  return horses[horses.length - 1];
}

function determineTopThree(horses) {
  // Predetermine the full finishing order via successive weighted random draws.
  // Each subsequent place is drawn from the remaining horses with probabilities
  // renormalized — the same method previously used only for 1st/2nd/3rd.
  const order = [];
  let remaining = horses.slice();

  while (remaining.length > 0) {
    const total = remaining.reduce((sum, h) => sum + h.probability, 0);
    const roll = Math.random() * total;
    let cumulative = 0;
    let pick = remaining[remaining.length - 1];
    for (const horse of remaining) {
      cumulative += horse.probability;
      if (roll < cumulative) {
        pick = horse;
        break;
      }
    }
    order.push(pick);
    remaining = remaining.filter(h => h.number !== pick.number);
  }

  const finishOrder = order.map(h => horses.findIndex(x => x.number === h.number));

  return {
    order,
    finishOrder,
    first: order[0],
    second: order[1],
    third: order[2],
    firstIndex: finishOrder[0],
    secondIndex: finishOrder[1],
    thirdIndex: finishOrder[2]
  };
}

const TRACK_RAIL = "─";

function buildTrack(progress, horseEmoji, trackLength = 20) {
  const pos = progress >= 100
    ? trackLength - 1
    : Math.min(trackLength - 1, Math.floor((progress / 100) * trackLength));

  const before = TRACK_RAIL.repeat(pos);
  const after  = TRACK_RAIL.repeat(trackLength - 1 - pos);

  return `|${before}${horseEmoji}${after}|🏁`;
}

const BACKER_WIDTH = 8;

// Who backed each lane, so a bettor finds their horse by name instead of by a
// glyph the system emoji font may render differently.
function backerTags(bets) {
  const byHorse = new Map();
  for (const bet of bets) {
    if (!byHorse.has(bet.horseIndex)) byHorse.set(bet.horseIndex, []);
    const names = byHorse.get(bet.horseIndex);
    if (!names.includes(bet.username)) names.push(bet.username);
  }

  const tags = new Map();
  for (const [horseIndex, names] of byHorse) {
    const extra = names.length - 1;
    const room = extra > 0 ? BACKER_WIDTH - String(extra).length - 2 : BACKER_WIDTH;
    const first = names[0].length > room ? `${names[0].slice(0, room - 1)}…` : names[0];
    tags.set(horseIndex, extra > 0 ? `${first} +${extra}` : first);
  }
  return tags;
}

function buildRaceDescription(horses, positions, tick, totalTicks, winnerIndex = null, finishOrder = [], topThree = null, bets = []) {
  const lines = [];
  const backers = backerTags(bets);

  const isFinished = winnerIndex !== null || positions.every(p => p >= 100);
  lines.push(
    isFinished
      ? "RACE FINISHED\n"
      : `RACE IN PROGRESS      Lap ${tick}/${totalTicks}\n`
  );

  const sortedIndices = horses.map((_, i) => i).sort((a, b) => horses[a].number - horses[b].number);

  const medalMap = new Map();

  // Crossing order is authoritative: once the field is at the line every
  // position reads 100, so standings can no longer tell them apart.
  const podium = finishOrder.length > 0
    ? finishOrder
    : (isFinished ? standingsFrom(positions) : []);

  podium.slice(0, 3).forEach((horseIndex, rank) => medalMap.set(horseIndex, MEDALS[rank]));

  for (const i of sortedIndices) {
    const track = buildTrack(positions[i], horses[i].emoji);
    const lane = `${horses[i].number} ${track}`;
    // The two share one column: a lane already wearing a medal does not also
    // need a find-me tag, and together they overrun the mobile width.
    const tag = RANK_LABELS[medalMap.get(i)] ?? backers.get(i) ?? "";
    lines.push(tag ? `${lane}  ${tag}` : lane);
  }

  return lines.join("\n");
}

function buildBettingDescription(horses, bets, endTime) {
  const lines = ["**Today's Horses:**", "```"];

  const sortedHorses = [...horses].sort((a, b) => a.number - b.number);

  const nameWidth = Math.max(...sortedHorses.map(h => h.name.length));

  for (const horse of sortedHorses) {
    const odds = `${horse.displayOdds}x`.padStart(6, " ");
    lines.push(`${horse.number} ${horse.emoji} ${horse.name.padEnd(nameWidth, " ")}${odds}  ${getOddsLabel(horse.probability)}`);
  }
  lines.push("```");

  if (bets.length > 0) {
    lines.push("\n**Current Bets:**");

    const betsByHorse = bets.reduce((acc, bet) => {
      (acc[bet.horseIndex] ??= []).push(bet);
      return acc;
    }, {});

    const sortedHorseIndices = Object.keys(betsByHorse)
      .map(Number)
      .sort((a, b) => horses[a].number - horses[b].number);

    for (const horseIdx of sortedHorseIndices) {
      const horse = horses[horseIdx];
      const horseBets = betsByHorse[horseIdx];

      if (horseBets.length === 1) {
        const bet = horseBets[0];
        lines.push(`• **${horse.number}** ${horse.emoji} ${bet.amount.toLocaleString()} koku · ${escapeMarkdown(bet.username)} (${formatBetType(bet.betType)})`);
        continue;
      }

      const total = horseBets.reduce((sum, b) => sum + b.amount, 0);
      const shown = horseBets.slice(0, MAX_BETTORS_PER_HORSE);
      const hidden = horseBets.length - shown.length;
      const users = shown
        .map(b => `${escapeMarkdown(b.username)} (${b.amount.toLocaleString()} ${formatBetType(b.betType)})`)
        .join(", ");
      const overflow = hidden > 0 ? `, +${hidden} more` : "";
      lines.push(`• **${horse.number}** ${horse.emoji} ${total.toLocaleString()} koku · ${users}${overflow}`);
    }
  } else {
    lines.push("\n*No bets yet. Be the first to place a bet!*");
  }

  // Rendered client-side and refreshed by Discord itself, so the countdown
  // ticks without the bot editing the message once per second.
  lines.push(`\n⏱️ Race starts <t:${Math.floor(endTime / 1000)}:R>`);

  return lines.join("\n");
}

// Cosmetic: each curve averages ~1.0, so style never decides the finish.
const PACE_CURVES = {
  front:  u => 1.45 - 0.90 * u,
  fader:  u => 1.60 - 1.30 * u,
  closer: u => 0.60 + 0.95 * u,
  steady: u => 1.00 + 0.15 * Math.sin(u * Math.PI),
};

const PACE_STYLES = Object.keys(PACE_CURVES);

const NOMINAL_PACE_DISTANCE = 92;

// Half a rendered cell, so every horse gains at least one cell every two laps.
const MIN_STEP = 2.5;

// Every horse now runs the full track, so that journey sets what a floor can promise.
function minimumStep(totalTicks) {
  return Math.min(MIN_STEP, 100 / totalTicks);
}

// Pace alone until here, so an outsider can lead early and still fade.
const CONVERGENCE_START = 0.55;

// The order is settled with this much of the race left, so the podium is
// readable on the run to the line instead of snapping on the final frame.
const RUN_IN_SHARE = 0.2;
const MIN_RUN_IN_TICKS = 2;

function settleTickFor(totalTicks) {
  const runIn = Math.max(MIN_RUN_IN_TICKS, Math.round(totalTicks * RUN_IN_SHARE));
  return Math.max(1, totalTicks - runIn);
}

// Places are separated in time, not in space: the podium crosses on its own
// lap each, the pack comes home together, and everyone reaches the line.
function crossingLap(rank, settleTick, totalTicks) {
  if (rank >= MEDALS.length) return totalTicks;
  return Math.min(totalTicks, settleTick + rank);
}

// Ordered by rank at the settle lap, so the run in is readable before anyone crosses.
function settleTargetFor(rank, settleTick, totalTicks) {
  const cross = crossingLap(rank, settleTick, totalTicks);
  return Math.max(0, (100 * settleTick) / cross - Math.max(0, rank - MEDALS.length + 1) * 0.9);
}

// Reaches 1 exactly on the settle tick, which is what makes the order land true.
function convergenceWeight(tick, totalTicks, settleTick) {
  const from = Math.max(1, Math.round(CONVERGENCE_START * totalTicks));
  if (tick >= settleTick) return 1;
  if (tick <= from || settleTick <= from) return 0;
  const progress = (tick - from) / (settleTick - from);
  return progress * progress;
}

function jitter() {
  return 0.78 + Math.random() * 0.44;
}

function rankOrder(topThree, horseCount) {
  const order = topThree?.finishOrder;
  if (Array.isArray(order) && order.length === horseCount) return order;

  // Older callers only carried the podium, so fill the rest by index.
  const podium = [topThree?.firstIndex, topThree?.secondIndex, topThree?.thirdIndex].filter(i => Number.isInteger(i));
  const rest = Array.from({ length: horseCount }, (_, i) => i).filter(i => !podium.includes(i));
  return [...podium, ...rest];
}

function advanceRace(horses, positions, topThree, tick = 1, totalTicks = 10) {
  const finishOrder = rankOrder(topThree, horses.length);
  const rankOf = new Map(finishOrder.map((horseIndex, rank) => [horseIndex, rank]));

  const u = Math.min(1, tick / totalTicks);
  const settleTick = settleTickFor(totalTicks);
  const weight = convergenceWeight(tick, totalTicks, settleTick);
  const isFinalTick = tick >= totalTicks;
  const isRunIn = tick > settleTick;
  const newFinishers = [];

  // Derived per tick so any configured tick count covers the track.
  const baseSpeed = NOMINAL_PACE_DISTANCE / totalTicks;
  const minStep = minimumStep(totalTicks);

  for (const horseIndex of finishOrder) {
    const rank = rankOf.get(horseIndex);
    const before = positions[horseIndex];
    const cross = crossingLap(rank, settleTick, totalTicks);

    if (tick >= cross) {
      positions[horseIndex] = 100;
      if (before < 100) newFinishers.push(horseIndex);
      continue;
    }

    const goal = isRunIn ? 100 : settleTargetFor(rank, settleTick, totalTicks);
    const lastTickOfPhase = isRunIn ? cross : settleTick;
    const remaining = Math.max(0, goal - before);
    const ticksLeft = Math.max(1, lastTickOfPhase - tick + 1);

    let step;
    if (isRunIn) {
      step = (remaining / ticksLeft) * (0.92 + Math.random() * 0.16);
    } else {
      const pace = PACE_CURVES[horses[horseIndex].style] ?? PACE_CURVES.steady;
      // Cosmetic drift only: convergence decides the finish.
      const formBias = 1 + ((horses[horseIndex].form ?? 50) / 100 - 0.5) * 0.12;
      const free = baseSpeed * pace(u) * jitter() * formBias;
      step = free * (1 - weight) + (remaining / ticksLeft) * weight;
    }

    // Reserving minStep for every later tick stops a horse arriving early and standing still.
    const ceiling = Math.max(minStep, remaining - minStep * (lastTickOfPhase - tick));
    step = Math.min(Math.max(step, Math.min(minStep, remaining)), ceiling);

    positions[horseIndex] = Math.min(goal, before + step);
  }

  return { positions, newFinishers };
}

function getDefaultRaceStats() {
  return { wins: 0, losses: 0, biggestWin: 0, biggestLoss: 0, totalBet: 0 };
}

async function generateRaceCommentary() {
  const prompt = `You are an energetic horse racing commentator. Generate 15 short, exciting one-line commentary phrases for a horse race.

Rules:
- Each line should be 1-2 short sentences maximum
- Make them exciting and varied (tension, surprise, humor)
- Do NOT reference any specific horse names - use generic terms like "the leader", "the favorite", "a longshot", "number 3"
- Include phrases for: race start, mid-race action, close finishes, underdogs pulling ahead, favorites struggling
- Don't use emoji
- Respond with ONLY the commentary lines, one per line, numbered 1-15

Example style:
"And they're off! The gates burst open with thundering hooves!"
"A longshot is making a surprising move from the back of the pack!"
"Neck and neck at the final stretch, this is going to be close!"
"The favorite is struggling today as the underdogs surge forward!"

Generate 15 unique commentary lines:`;

  try {
    const res = await llm.chat({
      model: CONVO_MODEL,
      messages: [
        { role: "system", content: "You are an exciting horse racing commentator. Respond with only numbered commentary lines, one per line. Never use specific horse names." },
        { role: "user", content: prompt },
      ],
      max_tokens: 1024,
      temperature: 0.9,
      timeoutMs: 15_000,
      label: "race-commentary",
      variant: "race_commentary",
    });

    const content = res.result.content?.trim();
    if (content) {
      const lines = content
        .split("\n")
        .map(line => line.replace(/^\d+\.\s*/, "").trim())
        .filter(line => line.length > 0 && line.length < 200);

      logger.log(`Generated ${lines.length} race commentary lines`);
      return lines.length >= 5 ? lines : getDefaultCommentary();
    }
  } catch (error) {
    logger.error(`Failed to generate race commentary: ${error.message}`);
  }

  return getDefaultCommentary();
}

function getDefaultCommentary() {
  return [
    "And they're off! The gates burst open!",
    "A chaotic start as horses jostle for position!",
    "The crowd roars as they thunder down the track!",
    "Neck and neck as they approach the first turn!",
    "A surprise move from the back of the pack!",
    "The favorite is making a move on the outside!",
    "Tension builds as they round the final bend!",
    "This is anyone's race at the halfway point!",
    "A longshot is pulling ahead unexpectedly!",
    "The leaders are fighting for every inch!",
    "The crowd is on their feet for this finish!",
    "A photo finish might be in the making!",
    "Every horse is giving it their all!",
    "The final stretch is approaching!",
    "What an incredible race we're witnessing!"
  ];
}

function buildRaceTitle(commentaries, tick, totalTicks, horses, positions, winnerIndex = null, finishOrder = []) {
  const isFinished = winnerIndex !== null;
  const progress = tick / totalTicks;

  if (isFinished && winnerIndex !== null) {
    const winner = horses[winnerIndex];
    const odds = winner.displayOdds;
    const oddsLabel = getOddsLabel(winner.probability);

    if (odds < 3) {
      const favoriteLines = [
        `The favorite ${winner.name} lives up to expectations!`,
        `${winner.name} delivers as predicted at ${odds}x odds!`,
        `No surprises here - ${winner.name} takes the win!`,
        `The crowd expected this - ${winner.name} dominates!`,
        `${winner.name} proves why they were the favorite!`
      ];
      return favoriteLines[Math.floor(Math.random() * favoriteLines.length)];
    } else if (odds < 6) {
      const contenderLines = [
        `${winner.name} pulls through with a solid performance!`,
        `A strong finish from ${winner.name} at ${odds}x!`,
        `${winner.name} takes the lead and holds on!`,
        `What a run from ${winner.name}!`,
        `${winner.name} crosses the line first!`
      ];
      return contenderLines[Math.floor(Math.random() * contenderLines.length)];
    } else if (odds < 12) {
      const longshotLines = [
        `An upset! ${winner.name} defies the odds at ${odds}x!`,
        `What a surprise! ${winner.name} takes it home!`,
        `The crowd is stunned - ${winner.name} wins at ${odds}x!`,
        `Nobody saw that coming! ${winner.name} claims victory!`,
        `An incredible upset by ${winner.name}!`
      ];
      return longshotLines[Math.floor(Math.random() * longshotLines.length)];
    } else {
      const outsiderLines = [
        `INCREDIBLE! ${winner.name} shocks everyone at ${odds}x!`,
        `A massive upset! ${winner.name} pulls off the miracle!`,
        `Unbelievable! ${winner.name} wins against all odds!`,
        `One of the biggest upsets ever - ${winner.name}!`,
        `The crowd goes wild! ${winner.name} at ${odds}x!`
      ];
      return outsiderLines[Math.floor(Math.random() * outsiderLines.length)];
    }
  }

  if (!commentaries || commentaries.length === 0) {
    return getDefaultCommentary()[Math.floor(Math.random() * getDefaultCommentary().length)];
  }

  let pool;
  if (tick === 1) {
    pool = commentaries.slice(0, 2);
  } else if (progress < 0.4) {
    pool = commentaries.slice(2, 6);
  } else if (progress < 0.7) {
    pool = commentaries.slice(6, 10);
  } else {
    pool = commentaries.slice(10, 13);
  }

  if (pool.length === 0) {
    pool = commentaries;
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = {
  summarizeBettors,
  buildResultsSection,
  fitDescription,
  escapeMarkdown,
  generateHorses,
  determineWinner,
  determineTopThree,
  calculatePayout,
  getOddsLabel,
  buildTrack,
  buildRaceDescription,
  buildBettingDescription,
  buildRaceTitle,
  advanceRace,
  generateRaceCommentary,
  getDefaultRaceStats,
  ADJECTIVES,
  NOUNS,
  EMOJIS,
};