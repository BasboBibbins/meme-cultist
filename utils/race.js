const { OpenAIApi, Configuration } = require('openai');
const { CHATBOT_LOCAL, RACE_PLACE_MULTIPLIER, RACE_SHOW_MULTIPLIER } = require('../config.js');
const logger = require('./logger');

let _openaiClient = null;
function getOpenAIClient(key) {
    if (!_openaiClient || _openaiClient._key !== key) {
        const configuration = new Configuration({
            apiKey: key,
            basePath: CHATBOT_LOCAL ? 'http://127.0.0.1:3000/v1/' : 'https://api.deepseek.com'
        });
        const client = new OpenAIApi(configuration);
        client._key = key;
        _openaiClient = client;
    }
    return _openaiClient;
}

function withTimeout(promise, ms, err = "Request timed out") {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(err), ms));
    return Promise.race([promise, timeout]);
}

const ADJECTIVES = [
    // Generic
    'Royal', 'Noble', 'Silver', 'Golden', 'Dark', 'Swift', 'Bold', 'Wild', 'Iron',
    'Midnight', 'Crimson', 'Blazing', 'Ancient', 'Sacred', 'Mighty', 'Phantom',
    'Eternal', 'Raging', 'Frozen', 'Thunder', 'Shadow',
    'Crusty', 'Wobbly', 'Sleepy', 'Soggy', 'Grumpy', 'Chonky', 'Dusty', 'Sneaky',
    'Hangry', 'Discount', 'Cursed', 'Broke', 'Slightly', 'Suspiciously',
    'Aggressively', 'Mediocre', 'Confused', 'Retired', 'Certified', 
    'Special', 'Silence', 'Fwenly', 'Definitely-Not-A',
    // Sethja Additions
    'Door', 'Jovial', 'Downtown', 'Superstitional',
    'Cyan', 'Resolute', 'Comely', 'Material', 'A-Mysterious', 
    'Garbage', 'Nighttime', 'Kidslookn', 'Hell', 'Undead', 
    'Nice', 'Matikane', 'Mikus-Favorite', 'Big', 'Desert', 
    'Dream', 'Gold', 'Go', 'Gun', 'Hurricane', 
    'Hearts', 'My-Lucky', 'King', 'Super', 'Night', 
    'Lady', 'Maximum', 'Mr', 'Nakayama', 'Opera', 
    'Peter', 'Pretty', 'Red', 'Blue', 'Green', 
    'White', 'Regret', 'Stay', 'Rapist', 'War', 
    'Wishing', 'Wonder', 'Admire', 'Empire', 'Assault', 
    'Best', 'Joe', 'John', 'Master', 'Flying', 
    'Falling', 'Jumping', 'Racing', 'Running', 'Funny', 
    'Forever', 'Grey', 'Justify', 'Kissin', 'Over', 
    'Thanks', 'The', 'Just-Wanna', 'Queen', 'Rice', 
    'Seize-The', 'Saint', 'Vodka', 'Not', 'Italian', 
    'Zippy', 'Silly', 'Goofy', 'Dilly-Dally', 'Willy', 
    'Your', 'Helluva', 'Piss', 'Shit', 'Ass', 
    'Chinese', 'Succulent', 'Democracy', 'Cute', 'Feminine', 
    'Half-Retard', 'SPED', 'Corporate', 'Minecraft', 'Pinball', 
    'Underage', 'Overage', 'Melodic', 'Saucy', 'Cheeky', 
    'Onion', 'Spicy', '2nd-Hand', 'Cauliflower', 'No', 
    'Grand', 'Mariors', 'Luigirs', 'Fightan', 'Anime', 
    'Hazbin', 'Tic-Toc', 'Family-Guy', 'A.I.', 'Falling',
    'My-Beautiful-Dark-Twisted', 
    // Umamusume
    'Daiwa', 'Mejiro', 'Narita', 'Symboli', 'Mihono',
    'Satono', 'Kitasan', 'Marvelous', 'Winning', 'Maruzen',
    'Bulletin', 'Lightning',
    // Rikishi
    'Yokozuna', 'Ozeki', 'Sekiwake', 'Komusubui', 'Maegashira', 
    // TMC Members
    'Bball', 'Clean', 'Confirmed', 'Top', 'Fwen', 
];

const NOUNS = [
    'Blade', 'Crown', 'Storm', 'Lance', 'Crest', 'Star', 'Comet', 'Arrow',
    'Dancer', 'Ruler', 'Sovereign', 'Champion', 'Warrior', 'Legend', 'Eclipse',
    'Horizon', 'Tempest', 'Valor', 'Spirit', 'Fire',
    'Noodle', 'Bucket', 'Socks', 'Muffin', 'Goblin', 'Potato', 'Biscuit', 'Waffle',
    'Accountant', 'Conspiracy', 'Refund', 'Intern', 'Napkin', 'Horoscope',
    'Regret', 'Situation', 'Vibez', 'Agenda', 'Omen', 'Opinion',
    // Sethja Additions
    'Board', 'Strikes', 'Strikes Thrice', 'Realism', 
    'Let-Loose', 'Touchable', 'Knob', 'Merryment', 'Skybox', 
    'Mind', 'Afternoon', 'Material', 'Morning', 'Figure', 
    'Bin', 'Knifemare', 'Nightmare', 'Nature', 'Fukukitaru', 
    'Tannhauser', 'Chocolatier', 'Caviar', 'Cigar', 'Gold', 
    'Journey', 'Ship', 'Man-Go', 'Squid', 'Battle-Golf', 
    'Heart', 'Spade', 'Club', 'Diamond', 'Security', 
    'Needles', 'Pan', 'Griffin', 'Derby', 'Simp', 
    'Koku', 'Game', 'In-Love', 'Gold', 'Heat', 
    'Chippy', 'Zooplegloop', 'Stage', 'Tahiti', 'BloonsMonkeySex', 
    'Horse', 'Rapist', 'Rape', 'Wishes', 'Mate', 
    'Ben', 'Burrow', 'Vista', 'XP', 'The-Twelfth', 
    'Cigarette', 'Crisp', 'Dick', 'Penis', 'Young', 
    'Hound', 'Lucky', 'Chief', 'Dancer', 'Nice', 
    'Dose', 'Doc', 'Drink', 'Cup', 'Parfait', 
    'Juicebox', 'Videogames', 'Gin', 'Beer', 'Opera-O', 
    'Rosso', 'Brother', 'Pasta', 'Tomato', 'Colors', 
    'Wash', 'Suckin', 'Name', 'Pomni', 'Shower', 
    'Manifest', 'Steve', 'Hitler', 'Evil-Hitler-Ghost', 'Adolf', 
    'Watanabe', 'Bebop', 'Dad', 'Council', 'Ring', 
    'Meatball', 'Repossession', 'Clone', 'Oil', 'Sexo-Sexo', 
    'Pickaxe', 'Axe', 'Hotel', 'Funny-Moments', 'Slop', 
    'Edge', 'Kart', 'Missile', 'Fantasy',
    // Umamusume
    'Suzuka', 'Scarlet', 'McQueen', 'Turbo', 'Bourbon', 'Teio', 'Rudolf',
    'Vodka', 'Tachyon', 'Yayahide', 'Brian', 'Cap', 'Helios',
    'Shakur', 'Taiki', 'Creek', 'Ticket', 'Sky',
    // Rikishi
    'Hoshoryu', 'Aonishki', 'Kirishima', 'Wakamotoharu', 'Wakatakakage', 
    'Abi', 'Ura', 'Gonoyama', '#Tobizaru', 'Ichiyamamoto', 
    // TMC Members
    'Spook', 'Merlington', 'Hayes', 'Seth', 'Ja8', 
    'Maestro', 'Marshall', 'Night-Hawk', '5hine', 'Akula', 
    'Ballin', 'Basbo', 'Jake', 'Toast', 'Proctor', 
    'Falcon', 'Fuzzles', 'Sean', 'Racer', 'Laser', 
    'Mammut', 'Monty', 'Joe', 'Finger', 'Coco', 
    'Pepper', 'Public', 'Notch', 'Top-Notch', 'Yeet', 
    'Damon', 'Bot', 'Sev'
];

const EMOJIS = ['🏇', '🐎', '🦄', '🦓', '🦌', '🐴', '🎠', '⭐'];

const ODDS_LABELS = [
    { threshold: 0.25, label: '🟢 Favorite' },
    { threshold: 0.10, label: '🟡 Contender' },
    { threshold: 0.05, label: '🟠 Longshot' },
    { threshold: 0,    label: '🔴 Outsider' },
];

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function getOddsLabel(probability) {
    return ODDS_LABELS.find(o => probability >= o.threshold)?.label ?? '🔴 Outsider';
}

function calculatePayout(betAmount, displayOdds, houseEdge = 0.10, betType = 'win') {
    let odds;
    switch (betType) {
        case 'place':
            odds = (displayOdds - 1) * RACE_PLACE_MULTIPLIER + 1;
            break;
        case 'show':
            odds = (displayOdds - 1) * RACE_SHOW_MULTIPLIER + 1;
            break;
        case 'win':
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
        const usesAdj = Math.random() < 0.8; 

        return {
            number: numbers[i],
            name: usesAdj ? `${adj[i]} ${noun[i]}` : noun[i],
            emoji: EMOJIS[i],
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
    // Pick winner using weighted random
    const first = determineWinner(horses);

    // Remove winner and renormalize for second place
    const remainingAfterFirst = horses.filter(h => h.number !== first.number);
    const totalProbAfterFirst = remainingAfterFirst.reduce((sum, h) => sum + h.probability, 0);
    const normalizedFirst = remainingAfterFirst.map(h => ({ ...h, probability: h.probability / totalProbAfterFirst }));

    // Pick second place
    let roll = Math.random();
    let cumulative = 0;
    let second = normalizedFirst[0];
    for (const horse of normalizedFirst) {
        cumulative += horse.probability;
        if (roll < cumulative) {
            second = horse;
            break;
        }
    }

    // Remove second and renormalize for third place
    const remainingAfterSecond = normalizedFirst.filter(h => h.number !== second.number);
    const totalProbAfterSecond = remainingAfterSecond.reduce((sum, h) => sum + h.probability, 0);
    const normalizedSecond = remainingAfterSecond.map(h => ({ ...h, probability: h.probability / totalProbAfterSecond }));

    // Pick third place
    roll = Math.random();
    cumulative = 0;
    let third = normalizedSecond[0];
    for (const horse of normalizedSecond) {
        cumulative += horse.probability;
        if (roll < cumulative) {
            third = horse;
            break;
        }
    }

    return {
        first,
        second,
        third,
        firstIndex: horses.findIndex(h => h.number === first.number),
        secondIndex: horses.findIndex(h => h.number === second.number),
        thirdIndex: horses.findIndex(h => h.number === third.number)
    };
}

function buildTrack(progress, horseEmoji, trackLength = 20) {
    if (progress >= 100) {
        return `|${'—'.repeat(trackLength)}${horseEmoji}|🏁`;
    }

    const pos    = Math.min(trackLength - 1, Math.floor((progress / 100) * trackLength));
    const before = '—'.repeat(pos);
    const after  = '—'.repeat(trackLength - 1 - pos);

    return `|${before}${horseEmoji}${after}|🏁`;
}

function buildRaceDescription(horses, positions, tick, totalTicks, winnerIndex = null, finishOrder = [], topThree = null) {
    const lines = [];

    const isFinished = winnerIndex !== null;
    lines.push(
        isFinished
            ? '🏁 **RACE FINISHED** 🏁\n'
            : `🏁 **RACE IN PROGRESS — Lap ${tick}/${totalTicks}** 🏁\n`
    );

    const sortedIndices = horses.map((_, i) => i).sort((a, b) => horses[a].number - horses[b].number);

    const medalMap = new Map();

    if (isFinished && finishOrder.length > 0) {
        // Final results: use finish order for medals
        const medals = ['🥇', '🥈', '🥉'];
        for (let i = 0; i < Math.min(3, finishOrder.length); i++) {
            medalMap.set(finishOrder[i], medals[i]);
        }
    } else if (finishOrder.length > 0) {
        // During race: use finish order for medals of horses that have crossed the line
        const medals = ['🥇', '🥈', '🥉'];
        for (let i = 0; i < Math.min(3, finishOrder.length); i++) {
            medalMap.set(finishOrder[i], medals[i]);
        }
    } else if (isFinished) {
        // Fallback when no finishOrder: assign medals by progress
        medalMap.set(winnerIndex, '🥇');
        const otherFinished = horses
            .map((_, i) => ({ i, progress: positions[i] }))
            .filter(h => h.i !== winnerIndex && h.progress >= 100)
            .sort((a, b) => b.progress - a.progress);

        const medals = ['🥈', '🥉'];
        otherFinished.slice(0, 2).forEach((h, rank) => {
            medalMap.set(h.i, medals[rank]);
        });
    } else {
        // During race without finishOrder: medals based on current position
        const finishedHorses = horses
            .map((_, i) => ({ i, progress: positions[i] }))
            .filter(h => h.progress >= 100)
            .sort((a, b) => {
                if (b.progress !== a.progress) {
                    return b.progress - a.progress;
                }
                return 0; // Maintain stable order if progress is identical
            });

        const medals = ['🥇', '🥈', '🥉'];
        finishedHorses.slice(0, 3).forEach((h, rank) => {
            medalMap.set(h.i, medals[rank]);
        });
    }

    for (const i of sortedIndices) {
        const medal = medalMap.get(i) ?? '  ';
        const track = buildTrack(positions[i], horses[i].emoji);
        lines.push(`${medal} **${horses[i].number}.** ${track}  **[${horses[i].displayOdds}x]**`);
    }

    return lines.join('\n');
}

function buildBettingDescription(horses, bets, endTime) {
    const lines = ['**Today\'s Horses:**', '```'];

    const sortedHorses = [...horses].sort((a, b) => a.number - b.number);

    for (const horse of sortedHorses) {
        lines.push(`${horse.number}. ${horse.name} ${horse.emoji}  [${horse.displayOdds}x]  ${getOddsLabel(horse.probability)}`);
    }
    lines.push('```');

    if (bets.length > 0) {
        lines.push('\n**Current Bets:**');

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
            const total = horseBets.reduce((sum, b) => sum + b.amount, 0);
            const users = horseBets.map(b => `${b.username} (${b.amount.toLocaleString()} ${(b.betType || 'win').charAt(0).toUpperCase() + (b.betType || 'win').slice(1)})`).join(', ');
            lines.push(`• **Horse ${horse.number}** (${horse.name}) — ${total.toLocaleString()} koku | ${users}`);
        }
    } else {
        lines.push('\n*No bets yet. Be the first to place a bet!*');
    }

    const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    lines.push(`\n⏱️ Race starts in **${remaining}s**...`);

    return lines.join('\n');
}

function advanceRace(horses, positions, topThree) {
    const newFinishers = [];

    for (let i = 0; i < horses.length; i++) {
        const prevProgress = positions[i];
        // Base advancement with reduced randomness
        let advance = 6 + Math.random() * 4; // 6-10, avg 8

        // Strong deterministic boosts for predetermined top 3
        // This ensures they finish in correct order
        if (i === topThree.firstIndex) {
            advance += 5 + Math.random() * 2; // +5-7, ensures 1st place
        } else if (i === topThree.secondIndex) {
            advance += 3 + Math.random() * 2; // +3-5, ensures 2nd place
        } else if (i === topThree.thirdIndex) {
            advance += 1 + Math.random() * 2; // +1-3, ensures 3rd place
        }

        // Form bonus (smaller impact, doesn't override predetermined order)
        advance += (horses[i].form / 100) * 1.5;

        positions[i] = Math.min(100, positions[i] + advance);

        if (prevProgress < 100 && positions[i] >= 100) {
            newFinishers.push(i);
        }
    }

    return { positions, newFinishers };
}

function getDefaultRaceStats() {
    return { wins: 0, losses: 0, biggestWin: 0, biggestLoss: 0, totalBet: 0 };
}

async function generateRaceCommentary(apiKey) {
    if (!apiKey) {
        logger.warn('No API key provided for race commentary generation');
        return getDefaultCommentary();
    }

    const openai = getOpenAIClient(apiKey);

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
        const res = await withTimeout(
            openai.createChatCompletion({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: 'You are an exciting horse racing commentator. Respond with only numbered commentary lines, one per line. Never use specific horse names.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 1024,
                temperature: 0.9
            }),
            15_000,
            'Race commentary generation timed out'
        );

        const { choices } = res.data;
        if (choices.length > 0 && choices[0].message) {
            const content = choices[0].message.content.trim();
            const lines = content
                .split('\n')
                .map(line => line.replace(/^\d+\.\s*/, '').trim())
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