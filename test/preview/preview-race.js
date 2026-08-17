/**
 * Prints every lap of a race exactly as Discord renders it, so pacing and
 * finish-line problems are visible without starting the bot.
 * Usage: node test/preview/preview-race.js
 *        npm run preview:race
 *        npm run preview:race -- --ticks 10 --seed 7
 */

const { generateHorses, determineTopThree, advanceRace, buildRaceDescription, buildRaceTitle } = require("../../utils/race");

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(args[i + 1]);
}

const TICKS = arg("ticks", 15);
const SEED = arg("seed", Math.floor(Math.random() * 1e9));

// Deterministic Math.random so a reported render can be reproduced from its seed.
let state = SEED >>> 0;
Math.random = () => {
  state = (state * 1664525 + 1013904223) >>> 0;
  return state / 4294967296;
};

const NAMES = [
  "Noble Blade", "Soggy Waffle", "Mighty Crest", "Star",
  "Slightly Opinion", "Grumpy Horoscope", "Royal Vibez", "Iron Lance",
];

const horses = generateHorses();
horses.forEach((h, i) => { h.name = NAMES[i]; });
const topThree = determineTopThree(horses);

const BETS = [
  { userId: "1", username: "basbo", horseIndex: 2, amount: 500, betType: "win" },
  { userId: "2", username: "averyverylongname", horseIndex: 5, amount: 250, betType: "show" },
  { userId: "3", username: "thirduser", horseIndex: 5, amount: 100, betType: "win" },
  { userId: "4", username: "Kai", horseIndex: 7, amount: 900, betType: "place" },
];

const positions = new Array(8).fill(0);
const finishOrder = [];
const crossedAt = new Map();

console.log(`seed ${SEED}   laps ${TICKS}\n`);
console.log("FIELD");
for (const h of horses) {
  const rank = topThree.finishOrder.indexOf(horses.indexOf(h));
  console.log(`  ${h.number} ${h.emoji} ${h.name.padEnd(18)}${String(h.displayOdds).padStart(5)}x  ${h.style.padEnd(7)} finishes ${rank + 1}`);
}
console.log(`\nTRUE ORDER  ${topThree.finishOrder.map(i => horses[i].number).join(" > ")}\n`);

for (let tick = 1; tick <= TICKS; tick++) {
  const { newFinishers } = advanceRace(horses, positions, topThree, tick, TICKS);
  for (const i of newFinishers) {
    if (!finishOrder.includes(i)) {
      finishOrder.push(i);
      crossedAt.set(i, tick);
    }
  }

  const title = buildRaceTitle(null, tick, TICKS, horses, positions, null, finishOrder);
  const body = buildRaceDescription(horses, positions, tick, TICKS, null, finishOrder, topThree, BETS);
  const atLine = positions.filter(p => p >= 100).length;

  console.log(`${"─".repeat(52)}\nLAP ${tick}/${TICKS}   ${atLine}/8 at the line   "${title}"`);
  console.log("```");
  console.log(body);
  console.log("```");
}

console.log(`${"─".repeat(52)}\nVERDICT`);
const stillRunning = positions.filter(p => p < 100).length;
console.log(`  horses at the line on the final lap : ${8 - stillRunning}/8 ${stillRunning ? "<-- PROBLEM" : "ok"}`);
console.log(`  crossing order                      : ${finishOrder.map(i => horses[i].number).join(" > ") || "(nobody crossed)"}`);
console.log(`  true order                          : ${topThree.finishOrder.map(i => horses[i].number).join(" > ")}`);
const podiumCrossings = topThree.finishOrder.slice(0, 3).map(i => crossedAt.get(i) ?? "never");
console.log(`  podium crossed on laps              : ${podiumCrossings.join(", ")}`);
