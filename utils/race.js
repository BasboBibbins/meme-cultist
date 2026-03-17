const ADJECTIVES = [
    'Royal', 'Noble', 'Silver', 'Golden', 'Dark', 'Swift', 'Bold', 'Wild', 'Iron',
    'Midnight', 'Crimson', 'Blazing', 'Ancient', 'Sacred', 'Mighty', 'Phantom',
    'Eternal', 'Raging', 'Frozen', 'Thunder', 'Shadow',
    'Crusty', 'Wobbly', 'Sleepy', 'Soggy', 'Grumpy', 'Chonky', 'Dusty', 'Sneaky',
    'Hangry', 'Discount', 'Cursed', 'Broke', 'Slightly', 'Suspiciously',
    'Aggressively', 'Mediocre', 'Confused', 'Retired', 'Certified', 'Definitely-Not-A',
    'Special', 'Silence', 'Daiwa', 'Mejiro', 'Narita', 'Symboli', 'Mihono',
    'Satono', 'Kitasan', 'Marvelous', 'Winning', 'Maruzen',
];

const NOUNS = [
    'Blade', 'Crown', 'Storm', 'Lance', 'Crest', 'Star', 'Comet', 'Arrow',
    'Dancer', 'Ruler', 'Sovereign', 'Champion', 'Warrior', 'Legend', 'Eclipse',
    'Horizon', 'Tempest', 'Valor', 'Spirit', 'Fire',
    'Noodle', 'Bucket', 'Socks', 'Muffin', 'Goblin', 'Potato', 'Biscuit', 'Waffle',
    'Accountant', 'Conspiracy', 'Refund', 'Intern', 'Napkin', 'Horoscope',
    'Regret', 'Situation', 'Vibez', 'Agenda', 'Omen', 'Opinion',
    'Suzuka', 'Scarlet', 'McQueen', 'Turbo', 'Bourbon', 'Teio', 'Rudolf',
    'Vodka', 'Tachyon', 'Falcon', 'Hayahide', 'Brian', 'Cap', 'Helios',
    'Shakur', 'Taiki', 'Creek', 'Ticket', 'Sky',
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

function calculatePayout(betAmount, displayOdds, houseEdge = 0.10) {
    return Math.floor(betAmount * displayOdds * (1 - houseEdge));
}

function generateHorses() {
    const adj  = shuffleArray([...ADJECTIVES]);
    const noun = shuffleArray([...NOUNS]);

    // Generate random form ratings (independent of horse number)
    const forms = Array.from({ length: 8 }, () => Math.floor(Math.random() * 91) + 10); // 10-100
    const totalForm = forms.reduce((sum, f) => sum + f, 0);

    // Assign random numbers to each horse
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

    // Sort by number for display (1-8)
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

function buildTrack(progress, horseEmoji, trackLength = 20) {
    if (progress >= 100) {
        return `|${'—'.repeat(trackLength)}${horseEmoji}|🏁`;
    }

    const pos    = Math.min(trackLength - 1, Math.floor((progress / 100) * trackLength));
    const before = '—'.repeat(pos);
    const after  = '—'.repeat(trackLength - 1 - pos);

    return `|${before}${horseEmoji}${after}|🏁`;
}

function buildRaceDescription(horses, positions, tick, totalTicks, winnerIndex = null, finishOrder = []) {
    const lines = [];

    // Header
    const isFinished = winnerIndex !== null;
    lines.push(
        isFinished
            ? '🏁 **RACE FINISHED** 🏁\n'
            : `🏁 **RACE IN PROGRESS — Lap ${tick}/${totalTicks}** 🏁\n`
    );

    // Sort horses by number for display
    const sortedIndices = horses.map((_, i) => i).sort((a, b) => horses[a].number - horses[b].number);

    // Determine medals
    const medalMap = new Map();

    if (isFinished && finishOrder.length > 0) {
        // Final results: use finish order
        medalMap.set(winnerIndex, '🥇');
        // Silver and bronze from finish order (skip winner)
        let rank = 1;
        for (const idx of finishOrder) {
            if (idx === winnerIndex) continue;
            if (rank === 1) medalMap.set(idx, '🥈');
            else if (rank === 2) medalMap.set(idx, '🥉');
            rank++;
            if (rank > 2) break;
        }
    } else if (isFinished) {
        // Fallback: winner gets gold, others by progress
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
        // During race: medals based on current position (who's in lead)
        const finishedHorses = horses
            .map((_, i) => ({ i, progress: positions[i] }))
            .filter(h => h.progress >= 100)
            .sort((a, b) => b.progress - a.progress);

        const medals = ['🥇', '🥈', '🥉'];
        finishedHorses.slice(0, 3).forEach((h, rank) => {
            medalMap.set(h.i, medals[rank]);
        });
    }

    // Build lines in number order
    for (const i of sortedIndices) {
        const medal = medalMap.get(i) ?? '  ';
        const track = buildTrack(positions[i], horses[i].emoji);
        lines.push(`${medal} **${horses[i].number}.** ${track}  **[${horses[i].displayOdds}x]**`);
    }

    return lines.join('\n');
}

function buildBettingDescription(horses, bets, endTime) {
    const lines = ['**Today\'s Horses:**', '```'];

    // Sort horses by number for consistent display (1-8)
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

        // Sort bets by horse number for consistent display
        const sortedHorseIndices = Object.keys(betsByHorse)
            .map(Number)
            .sort((a, b) => horses[a].number - horses[b].number);

        for (const horseIdx of sortedHorseIndices) {
            const horse = horses[horseIdx];
            const horseBets = betsByHorse[horseIdx];
            const total = horseBets.reduce((sum, b) => sum + b.amount, 0);
            const users = horseBets.map(b => `${b.username} (${b.amount.toLocaleString()})`).join(', ');
            lines.push(`• **Horse ${horse.number}** (${horse.name}) — ${total.toLocaleString()} koku | ${users}`);
        }
    } else {
        lines.push('\n*No bets yet. Be the first to place a bet!*');
    }

    const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    lines.push(`\n⏱️ Race starts in **${remaining}s**...`);

    return lines.join('\n');
}

/**
 * Advances horse positions for one animation tick
 * Returns updated positions and new finishers (horses that crossed 100% this tick)
 * @param {Array} horses - Array of horse objects
 * @param {Array} positions - Current positions (mutated in place)
 * @param {number} winnerIndex - Index of pre-determined winner
 * @returns {{ positions: Array, newFinishers: Array }}
 */
function advanceRace(horses, positions, winnerIndex) {
    const newFinishers = [];

    for (let i = 0; i < horses.length; i++) {
        const prevProgress = positions[i];
        let advance = 5 + Math.random() * 7;

        if (i === winnerIndex) advance += 2 + Math.random() * 3;

        advance += (horses[i].form / 100) * 2;

        positions[i] = Math.min(100, positions[i] + advance);

        // Track horses that just finished this tick
        if (prevProgress < 100 && positions[i] >= 100) {
            newFinishers.push(i);
        }
    }

    return { positions, newFinishers };
}

function getDefaultRaceStats() {
    return { wins: 0, losses: 0, biggestWin: 0, biggestLoss: 0, totalBet: 0 };
}

module.exports = {
    generateHorses,
    determineWinner,
    calculatePayout,
    getOddsLabel,
    buildTrack,
    buildRaceDescription,
    buildBettingDescription,
    advanceRace,
    getDefaultRaceStats,
    ADJECTIVES,
    NOUNS,
    EMOJIS,
};