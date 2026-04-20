/**
 * Theme registry.
 *
 * Every theme the bot ships is defined here.  The classic base is imported
 * from base.js; all others only need to declare the keys they override.
 *
 * Theme tiers:
 *   colorway  - palette swap only, no custom art
 *   styled    - palette swap and background images, but default sprites
 *   full      - custom sprites, background images, and colors for all games
 *   limited   - seasonal/event availability, determined by date range
 */

const path = require('path');
const classic = require('./base');

const ASSETS_BASE = path.join(__dirname, '..', '..', 'assets', 'imgs', 'slots');
const BACKGROUND_BASE = path.join(__dirname, '..', '..', 'assets', 'imgs', 'themes');

// ── Helpers for defining themes with less boilerplate ─────────────────────────────
function colorway(id, name, description, price, weight, emoji, colors, overrides) {
    return { id, name, description, tier: 'colorway', price, weight, emoji, game: null, colors, overrides: overrides || {} };
}

function styled(id, name, description, price, weight, emoji, colors, overrides) {
    return { id, name, description, tier: 'styled', price, weight, emoji, game: null, colors, overrides: overrides || {} };
}

function full(id, name, description, price, weight, emoji, colors, overrides, game) {
    return { id, name, description, tier: 'full', price, weight, emoji, game: game || null, colors, overrides };
}

function limited(id, name, description, price, emoji, availability, colors, overrides) {
    return { id, name, description, tier: 'limited', price, weight: null, emoji, game: null, colors, overrides: overrides || {}, availability };
}

function sprites(themeId, labels) {
    return labels.map((label, index) => ({
        type: 'sprite',
        path: path.join(ASSETS_BASE, `${themeId}.png`),
        index,
        label,
    }));
}

function poker(colors, overrides) {
    return { feltColor: colors.feltColor, tableGreen: colors.tableGreen, gold: colors.gold, goldDark: colors.goldDark, ...overrides };
}

// ── Theme color palettes (pre-declared so poker() can reuse them) ─────────────────

const memecultColors = {
    background:  path.join(BACKGROUND_BASE, 'memecult.png'),
    feltColor:   'rgb(42, 40, 38, 0.7)',
    feltDark:    'rgb(26, 24, 22, 0.85)',
    tableGreen:  '#4a5a28',
    gold:        '#9ab55c',
    goldDark:    '#7a8a3e',
    goldBronze:  '#5a6a2e',
    textWhite:   '#d0ccc0',
    textBlack:   '#0a0908',
    textWin:     '#a8c06a',
    textLoss:    '#c85a3a',
    textPrimary: '#9ab55c',
    embedColor:  0x2a2826,
};

const neonColors = {
    background:  path.join(BACKGROUND_BASE, 'neon.png'),
    feltColor:   'rgba(26, 10, 46, 0.8)',
    feltDark:    '#0f0520',
    tableGreen:  '#2a1a4a',
    gold:        '#c0c0c0',
    goldDark:    '#808080',
    goldBronze:  '#6a6a6a',
    textWhite:   '#e0d8f0',
    textWin:     '#88ffaa',
    textLoss:    '#ff6688',
    textPrimary: '#c0c0c0',
};

const feudalJapanColors = {
    background:  path.join(BACKGROUND_BASE, 'feudalJapan.png'),
    feltColor:   'rgba(74, 0, 0, 0.8)',
    feltDark:    'rgba(42, 0, 0, 0.8)',
    tableGreen:  'rgba(58, 0, 0, 0.5)',
    gold:        '#ffd700',
    goldDark:    '#c8a830',
    goldBronze:  '#8b6914',
    textWhite:   '#ffffff',
    textWin:     '#44ff44',
    textLoss:    '#ff4444',
    textPrimary: '#ffd700',
};

const cosmicColors = {
    background:  path.join(BACKGROUND_BASE, 'cosmic.png'),
    feltColor:   'rgba(10, 14, 26, 0.8)',
    feltDark:    '#060a14',
    tableGreen:  '#121830',
    gold:        '#b8c0d0',
    goldDark:    '#7a8090',
    goldBronze:  '#5a6478',
    textWhite:   '#e0e8ff',
    textBlack:   '#050810',
    textWin:     '#88ff44',
    textLoss:    '#ff3388',
    textPrimary: '#00ccff',
    embedColor:  0x0a0e1a,
};

const dessertColors = {
    background:  path.join(BACKGROUND_BASE, 'dessert.png'),
    feltColor:   'rgba(59, 26, 10, 0.8)',
    feltDark:    '#2a1008',
    tableGreen:  '#4e2212',
    gold:        '#f5e0c0',
    goldDark:    '#c8a87a',
    goldBronze:  '#8b6540',
    textWhite:   '#fff5f0',
    textBlack:   '#1a0a04',
    textWin:     '#ff88cc',
    textLoss:    '#cc4444',
    textPrimary: '#f7c8d8',
    embedColor:  0x3b1a0a,
};

const deepSeaColors = {
    background:  path.join(BACKGROUND_BASE, 'deepSea.png'),
    feltColor:   'rgba(8, 14, 42, 0.8)',
    feltDark:    '#050a28',
    tableGreen:  '#0c1638',
    gold:        '#5a9a8a',
    goldDark:    '#3e7a6a',
    goldBronze:  '#2a5a4e',
    textWhite:   '#d0e8f0',
    textBlack:   '#040818',
    textWin:     '#00ffd0',
    textLoss:    '#ff6b8a',
    textPrimary: '#80d8c0',
    embedColor:  0x080e2a,
};

// ─────────────────────────────────────────────────────────────────────
const themes = {
    classic,

    // ── Limited themes (date-range availability; extremely rare) ────────────────────

    memecult: limited('memecult', 'Meme Cult',
        'A launch-exclusive theme representing the Meme Cult hierarchy. TMC forever!',
        1000000, '<:mlgdoge:1495823525250863236>',
        { start: { month: 4, day: 20, year: 2026 }, end: { month: 4, day: 30, year: 2026 } },
        memecultColors,
        {
            slots: {
                reelBackground:      'rgb(26, 24, 22, 0.85)',
                frameColor:          '#9ab55c',
                frameDarkColor:      '#7a8a3e',
                frameBronze:         '#5a6a2e',
                dividerColor:        '#3a3836',
                highlightWin:        'rgba(154, 181, 92, 0.55)',
                bannerBackground:    '#1f1d1b',
                bannerBackgroundEnd: '#141210',
                motionBlurOverlay:   'rgba(42, 40, 38, 0.5)',
                paylineColors:       ['#9ab55c', '#c8b870', '#c85a3a', '#7a8a3e', '#d0ccc0'],
                symbols: sprites('memecult', ['Peasant', 'Worshipper', 'Priest', 'Bishop', 'Archbishop', 'Cardinal', 'Pope', 'MLG Doge', 'OTTO!', 'DARK OTTO!']),
            },
            roulette: {
                woodInner:       '#3a3836',
                woodMid:         '#2a2826',
                woodOuter:       '#1a1816',
                goldRim:         '#9ab55c',
                pocketRed:       '#a84830',
                pocketBlack:     '#1a1816',
                pocketGreen:     '#7a8a3e',
                winnerHighlight: '#9ab55c',
                textBlack:       '#0a0908',
                textWhite:       '#d0ccc0',
                feltInner:       '#4a5a28',
                feltMid:         '#3a4820',
                feltOuter:       '#2a3618',
                spokeColor:      '#9ab55c',
                hubLight:        '#c8d890',
                hubMid:          '#9ab55c',
                hubDark:         '#5a6a2e',
                hubStroke:       '#d0ccc0',
                tableGreen:      '#4a5a28',
                zeroGreen:       '#7a8a3e',
                numberRed:       '#a84830',
                numberBlack:     '#1a1816',
                betArea:         '#3a4820',
                betBorder:       '#9ab55c',
                resultOverlay:   'rgba(42, 40, 38, 0.85)',
                resultBorder:    '#9ab55c',
            },
            poker: poker(memecultColors, { feltColor: 'rgba(42, 40, 38, 0.85)' }),
        },
    ),
    /*
        * TODO: List of limited themes I want to create post-launch:
        - Fwen Cult (June 11-June 18): Celebrating this iteration of the Discord, featuring new-gen memecult culture and the fwen mascot (miku plushie).
        - Halloween (Oct 1-Oct 31): A spooky theme with Halloween symbols and a dark color palette.
        - Christmas (Dec 1-Dec 31): A festive theme with Christmas symbols and a red/green color palette.
        - New Year (Jan 1-Jan 7): A celebratory theme with fireworks and a vibrant color palette.
        - Valentine's Day (Feb 1-Feb 14): A romantic theme with hearts and a pink/red color palette.
        - St. Patrick's Day (Mar 1-Mar 17): A lucky theme with shamrocks and a green/gold color palette.
        - July 4th (June 28-July 7): An American Independence Day theme with patriotic symbols and a red/white/blue color palette.
        - Easter (April 1-April 15): A springtime theme with Easter eggs and a pastel color palette.
        - Miku Day (Aug 31-Sept 7): A theme celebrating Hatsune Miku's birthday, featuring Miku-themed symbols and a teal color palette.
        - Precision (June 23-June 30): A theme inspired by the Precision Roleplay DarkRP server. Dark color with yellow-green accents.
    */

    // ── Full themes (custom sprites + colors for all games) ─────────────────────────

    neon: full('neon', 'Neon Arcade',
        'A vibrant neon theme with glowing symbols.',
        150000, 10, '🪩', neonColors,
        {
            slots: {
                reelBackground:      'rgba(18, 8, 40, 0.75)',
                frameColor:          '#c0c0c0',
                frameDarkColor:      '#808080',
                frameBronze:         '#6a6a6a',
                dividerColor:        '#2a1a4a',
                highlightWin:        'rgba(192, 192, 192, 0.5)',
                bannerBackground:    '#1a0030',
                bannerBackgroundEnd: '#0f001a',
                motionBlurOverlay:   'rgba(15, 5, 32, 0.5)',
                paylineColors:       ['#ff5577', '#55ff99', '#5588ff', '#ffaa44', '#cc55ff'],
                symbols: sprites('neon', ['Cherry', 'Bell', 'Lemon', 'Grapes', 'Orange', 'Apple', 'BAR', 'Seven', 'Wild', 'Bonus']),
            },
            roulette: {
                woodInner: '#2e1a4a',
                woodMid: '#1a0a2e',
                woodOuter: '#0f0520',
                goldRim: '#c0c0c0',
                pocketRed: '#ff0055',
                pocketBlack: '#1a0a2e',
                pocketGreen: '#00ffcc',
                winnerHighlight: '#ffffff',
                textBlack: '#1a0a2e',
                textWhite: '#e0d8f0',
                feltInner: '#1a0a2e',
                feltMid: '#2a1a4a',
                feltOuter: '#1a0a2e',
                spokeColor: '#c0c0c0',
                hubLight: '#e0d8f0',
                hubMid: '#c0c0c0',
                hubDark: '#808080',
                hubStroke: '#ffffff',
                tableGreen: '#2a1a4a',
                zeroGreen: '#00ffcc',
                numberRed: '#ff0055',
                numberBlack: '#1a0a2e',
                betArea: '#3a2a5a',
                betBorder: '#c0c0c0',
                resultOverlay: 'rgba(26, 10, 46, 0.85)',
                resultBorder: '#00ffcc',
            },
            poker: poker(neonColors),
        },
        'slots',
    ),

    feudalJapan: full('feudalJapan', 'Feudal Japan',
        'Traditional Japanese theme with feudal symbols.',
        250000, 10, '🎋', feudalJapanColors,
        {
            slots: {
                reelBackground:      'rgba(26, 0, 0, 0.75)',
                frameColor:          '#ffd700',
                frameDarkColor:      '#c8a830',
                frameBronze:         '#8b6914',
                dividerColor:        '#3a0000',
                highlightWin:        'rgba(255, 215, 0, 0.6)',
                bannerBackground:    '#000000',
                bannerBackgroundEnd: '#1a0000',
                motionBlurOverlay:   'rgba(26, 0, 0, 0.5)',
                paylineColors:       ['#ff0000', '#ffd700', '#ffffff', '#ffaa00', '#aa0000'],
                symbols: sprites('feudalJapan', ['Bamboo', 'Torii Gate', 'Hanafuda', 'Castle', 'Blossom', 'Dolls', 'Katana', 'Dragon', 'Fan', 'Lantern']),
            },
            roulette: {
                woodInner: '#5d2906',
                woodMid: '#3d1b04',
                woodOuter: '#2d1503',
                goldRim: '#ffd700',
                pocketRed: '#cc0000',
                pocketBlack: '#1a1a1a',
                pocketGreen: '#006400',
                winnerHighlight: '#ffd700',
                textBlack: '#2d1503',
                textWhite: '#ffffff',
                feltInner: 'rgba(74, 0, 0, 0.8)',
                feltMid: 'rgba(106, 0, 0, 0.8)',
                feltOuter: 'rgba(58, 0, 0, 0.8)',
                spokeColor: '#ffd700',
                hubLight: '#ffd700',
                hubMid: '#c8a830',
                hubDark: '#8b6914',
                hubStroke: '#ffffff',
                tableGreen: 'rgba(58, 0, 0, 0.5)',
                zeroGreen: '#006400',
                numberRed: '#cc0000',
                numberBlack: '#1a1a1a',
                betArea: '#5a0000',
                betBorder: '#ffd700',
                resultOverlay: 'rgba(74, 0, 0, 0.85)',
                resultBorder: '#ffd700',
            },
            poker: poker(feudalJapanColors),
        },
        'slots',
    ),

    cosmic: full('cosmic', 'Cosmic',
        'A extraterrestrial theme with cosmic symbols and a starry background.',
        500000, 5, '🌌', cosmicColors,
        {
            slots: {
                reelBackground:      'rgba(8, 12, 24, 0.75)',
                frameColor:          '#b8c0d0',
                frameDarkColor:      '#7a8090',
                frameBronze:         '#5a6478',
                dividerColor:        '#1a2040',
                highlightWin:        'rgba(0, 204, 255, 0.5)',
                bannerBackground:    '#0a0020',
                bannerBackgroundEnd: '#050010',
                motionBlurOverlay:   'rgba(10, 14, 26, 0.5)',
                paylineColors:       ['#00ccff', '#ff3388', '#88ff44', '#ff8800', '#aa44ff'],
                symbols: sprites('cosmic', ['Planet', 'Rocket', 'Asteroid', 'Alien', 'Sattelite', 'Star', 'Nebula', 'Comet', 'Galaxy', 'Bonus']),
            },
            roulette: {
                woodInner:       '#2a3050',
                woodMid:         '#1a2040',
                woodOuter:       '#0e1428',
                goldRim:         '#b8c0d0',
                pocketRed:       '#ff3388',
                pocketBlack:     '#0a0e1a',
                pocketGreen:     '#88ff44',
                winnerHighlight: '#00ccff',
                textBlack:       '#0a0e1a',
                textWhite:       '#e0e8ff',
                feltInner:       '#121830',
                feltMid:         '#1a2040',
                feltOuter:       '#0e1428',
                spokeColor:      '#b8c0d0',
                hubLight:        '#e0e8ff',
                hubMid:          '#b8c0d0',
                hubDark:         '#7a8090',
                hubStroke:       '#00ccff',
                tableGreen:      '#121830',
                zeroGreen:       '#88ff44',
                numberRed:       '#ff3388',
                numberBlack:     '#0a0e1a',
                betArea:         '#1a2248',
                betBorder:       '#b8c0d0',
                resultOverlay:   'rgba(10, 14, 26, 0.85)',
                resultBorder:    '#00ccff',
            },
            poker: poker(cosmicColors),
        },
    ),

    dessert: full('dessert', 'Sweet Tooth',
        'A candy land of chocolate, bubblegum, and sweets.',
        500000, 5, '🍰', dessertColors,
        {
            slots: {
                reelBackground:      'rgba(42, 16, 8, 0.75)',
                frameColor:          '#f5e0c0',
                frameDarkColor:      '#c8a87a',
                frameBronze:         '#8b6540',
                dividerColor:        '#5c3018',
                highlightWin:        'rgba(255, 136, 204, 0.55)',
                bannerBackground:    '#2a0a10',
                bannerBackgroundEnd: '#1a0608',
                motionBlurOverlay:   'rgba(42, 16, 8, 0.5)',
                paylineColors:       ['#ff69b4', '#66d98e', '#f5d742', '#e84040', '#8fd4f5'],
                symbols: sprites('dessert', ['Lollipop', 'Cupcake', 'Candy Cane', 'Gummy Bear', 'Chocolate', 'Candy', 'BAR', 'Jawbreaker', 'Wild', 'Golden Ticket']),
            },
            roulette: {
                woodInner:       '#5c2e14',
                woodMid:         '#3b1a0a',
                woodOuter:       '#2a1008',
                goldRim:         '#f5e0c0',
                pocketRed:       '#e84040',
                pocketBlack:     '#2a1008',
                pocketGreen:     '#66d98e',
                winnerHighlight: '#ff88cc',
                textBlack:       '#1a0a04',
                textWhite:       '#fff5f0',
                feltInner:       '#4e2212',
                feltMid:         '#5c3018',
                feltOuter:       '#3b1a0a',
                spokeColor:      '#f5e0c0',
                hubLight:        '#fff5f0',
                hubMid:          '#f5e0c0',
                hubDark:         '#c8a87a',
                hubStroke:       '#ff88cc',
                tableGreen:      '#4e2212',
                zeroGreen:       '#66d98e',
                numberRed:       '#e84040',
                numberBlack:     '#2a1008',
                betArea:         '#5c3018',
                betBorder:       '#f5e0c0',
                resultOverlay:   'rgba(42, 16, 8, 0.85)',
                resultBorder:    '#ff88cc',
            },
            poker: poker(dessertColors),
        },
    ),

    deepSea: full('deepSea', 'Deep Sea',
        'Bioluminescent deep ocean with midnight blues, electric teal, and coral pink accents.',
        500000, 5, '🪸', deepSeaColors,
        {
            slots: {
                reelBackground:      'rgba(6, 10, 32, 0.75)',
                frameColor:          '#5a9a8a',
                frameDarkColor:      '#3e7a6a',
                frameBronze:         '#2a5a4e',
                dividerColor:        '#142040',
                highlightWin:        'rgba(0, 255, 208, 0.5)',
                bannerBackground:    '#0a0630',
                bannerBackgroundEnd: '#050320',
                motionBlurOverlay:   'rgba(8, 14, 42, 0.5)',
                paylineColors:       ['#00ffd0', '#b388ff', '#ff7b8a', '#80d8c0', '#6a8aff'],
                symbols: sprites('deepSea', ['Anglerfish', 'Jellyfish', 'Seahorse', 'Coral', 'Pearl', 'Shell', 'BAR', 'Trident', 'Wild', 'Treasure']),
            },
            roulette: {
                woodInner:       '#142838',
                woodMid:         '#0c1c2c',
                woodOuter:       '#081420',
                goldRim:         '#5a9a8a',
                pocketRed:       '#ff6b8a',
                pocketBlack:     '#080c28',
                pocketGreen:     '#00ffd0',
                winnerHighlight: '#00ffd0',
                textBlack:       '#040818',
                textWhite:       '#d0e8f0',
                feltInner:       '#0e1838',
                feltMid:         '#0a1230',
                feltOuter:       '#060c20',
                spokeColor:      '#5a9a8a',
                hubLight:        '#d0e8f0',
                hubMid:          '#5a9a8a',
                hubDark:         '#3e7a6a',
                hubStroke:       '#00ffd0',
                tableGreen:      '#0c1638',
                zeroGreen:       '#00ffd0',
                numberRed:       '#ff6b8a',
                numberBlack:     '#080c28',
                betArea:         '#101a40',
                betBorder:       '#5a9a8a',
                resultOverlay:   'rgba(8, 14, 42, 0.85)',
                resultBorder:    '#00ffd0',
            },
            poker: poker(deepSeaColors),
        },
    ),

    /*
        * TODO: List of full themes I want to create post-launch (with custom slot symbols, roulette textures, and poker cards):
        - Cabaret: Wood and velvet textures with deep reds, golds, and purples. Slot symbols could be cabaret-themed (top hat, cane, showgirl, etc). Roulette could have a luxurious wood grain and gold accents.
        - Sparkle: PICMIX/BLINGEE-inspired theme with gaudy sparkles, rhinestones, and glitter textures. Bright colors like hot pink, electric blue, and lime green. Slot symbols could be sparkly objects (diamond, star, heart, etc). Roulette could have a glittery background and sparkling highlights.
        - Bling: Similar to Sparkle but gold/white/light blue color palette and more focused on a luxurious, ostentatious aesthetic. Slot symbols could be blinged-out versions of classic symbols (diamond cherry, gold bell, etc). Roulette could have a shiny metallic finish and diamond accents.
        - Bloons: A fun, colorful theme inspired by the Bloons Tower Defense game series. Slot symbols could be different colored bloons and monkey towers. Roulette could have a bright, playful design with balloon motifs and vibrant colors.
        - Airshow: Think Top Gun on NES: a retro 80s aviation theme with pixel art slot symbols (fighter jet, pilot helmet, missile, etc) and a runway-inspired roulette design. Colors could be navy, gray, and red with neon accents.
        - Y2K: A blobject-inspired theme with glossy, futuristic textures and a color palette of silver, black, and electric blue. Slot symbols could be Y2K-themed objects (floppy disk, old cell phone, CD, etc). Roulette could have a sleek, metallic design with digital-style numbers and accents.
        - Touhou: A theme based on the Touhou Project bullet hell games, featuring slot symbols of popular characters and a roulette design inspired by the games' aesthetic. Colors could be a mix of dark and vibrant tones to capture the series' unique style.
        - Glass: A Liquid Glass-inspired theme similar to iOS 26s new design language, with frosted glass textures, soft shadows, and a color palette of cool blues, grays, and whites. Slot symbols could be glassy versions of classic symbols (glass cherry, frosted bell, etc). Roulette could have a sleek, transparent design with subtle reflections and highlights.
        - Term: A terminal/command-line-inspired theme with a dark background, green text, and pixelated slot symbols (like ASCII art). Roulette could have a retro computer design with a monochrome color scheme and pixelated numbers.
    */

    // ── Styled themes (palette swap + background image, default sprites) ────────────

    sunset: styled('sunset', 'Sunset',
        'Warm gradient background with orange, pink, and purple hues. A vibrant, eye-catching design.',
        50000, 20, '🌅',
        {
            background:  path.join(BACKGROUND_BASE, 'sunset.png'),
            feltColor:   'rgba(26, 10, 46, 0.8)',
            feltDark:    'rgba(26, 10, 46, 0.8)',
            tableGreen:  'rgba(26, 10, 46, 0.8)',
            gold:        '#c0c0c0',
            goldDark:    '#808080',
            goldBronze:  '#a0a0a0',
            textWhite:   '#ffffff',
            textWin:     '#88cc88',
            textLoss:    '#ff6677',
            textPrimary: '#c0c0c0',
            embedColor:  0x1a0a2e,
        },
        {
            slots: {
                reelBackground:      'rgba(26, 10, 46, 0.75)',
                frameColor:          '#c0c0c0',
                frameDarkColor:      '#808080',
                frameBronze:         '#a0a0a0',
                dividerColor:        '#1a0a2e',
                highlightWin:        'rgba(136, 204, 136, 0.5)',
                bannerBackground:    '#1a0a2e',
                bannerBackgroundEnd: '#0d0517',
                motionBlurOverlay:   'rgba(26, 10, 46, 0.5)',
                paylineColors:       ['#88cc88', '#ff6677', '#c0c0c0', '#ffcc00', '#66dd88'],
            },
        },
    ),

    // ── Colorway themes (palette only, all games) ───────────────────

    midnight: colorway('midnight', 'Midnight',
        'Deep navy and silver. A sleek, cooler-toned alternative to classic.',
        10000, 60, '🌙',
        {
            feltColor:   '#000033',
            feltDark:    '#00001a',
            tableGreen:  '#000044',
            gold:        '#c0c0c0',
            goldDark:    '#808080',
            goldBronze:  '#a0a0a0',
            textWhite:   '#ffffff',
            textWin:     '#44ccaa',
            textLoss:    '#ff5566',
            textPrimary: '#c0c0c0',
            embedColor:  0x000033,
        },
    ),

    cherryPop: colorway('cherryPop', 'Cherry Pop',
        'Rich rose and soft pink frames. Fun and retro.',
        10000, 60, '🍒',
        {
            feltColor:   '#8b2252',
            feltDark:    '#6b1a3e',
            tableGreen:  '#a03060',
            gold:        '#f0c8d8',
            goldDark:    '#d4a0b8',
            goldBronze:  '#b07090',
            textWhite:   '#fff0f5',
            textWin:     '#66ffaa',
            textLoss:    '#ff5068',
            textPrimary: '#f0c8d8',
            embedColor:  0x8b2252,
        },
    ),

    emerald: colorway('emerald', 'Emerald',
        'Richer, deeper greens than Classic. A premium classic tier.',
        7500, 60, '💚',
        {
            feltColor:   '#004d00',
            feltDark:    '#003300',
            tableGreen:  '#006600',
            gold:        '#ffd700',
            goldDark:    '#c8a830',
            goldBronze:  '#8b6914',
            textWhite:   '#ffffff',
            textWin:     '#55ee55',
            textLoss:    '#ee5544',
            textPrimary: '#ffd700',
            embedColor:  0x004d00,
        },
    ),

    ocean: colorway('ocean', 'Ocean',
        'Deep teal felt with warm coral accents and seafoam highlights.',
        10000, 60, '🌊',
        {
            feltColor:   '#0a4f5c',
            feltDark:    '#063840',
            tableGreen:  '#1a6878',
            gold:        '#e8a065',
            goldDark:    '#b87840',
            goldBronze:  '#986038',
            textWhite:   '#e0f0f0',
            textWin:     '#55ddaa',
            textLoss:    '#ff6655',
            textPrimary: '#90d8d0',
            embedColor:  0x0a4f5c,
        },
    ),

    ember: colorway('ember', 'Ember',
        'Deep charcoal felt with orange and amber frame colors.',
        10000, 60, '🔥',
        {
            feltColor:   '#333333',
            feltDark:    '#1a1a1a',
            tableGreen:  '#444444',
            gold:        '#ff8c00',
            goldDark:    '#cc7a00',
            goldBronze:  '#8b4513',
            textWhite:   '#ffffff',
            textWin:     '#88cc44',
            textLoss:    '#ff6644',
            textPrimary: '#ffae42',
            embedColor:  0x333333,
        },
    ),

    frost: colorway('frost', 'Frost',
        'Icy steel-blue felt with pale silver frames.',
        10000, 60, '❄️',
        {
            feltColor:   '#3a5a70',
            feltDark:    '#2a4050',
            tableGreen:  '#4a6a80',
            gold:        '#c8d8e8',
            goldDark:    '#98b0c0',
            goldBronze:  '#7898a8',
            textWhite:   '#f0f5ff',
            textWin:     '#66ddcc',
            textLoss:    '#ff7788',
            textPrimary: '#b0d0e4',
            embedColor:  0x3a5a70,
        },
    ),

    royalPurple: colorway('royalPurple', 'Royal Purple',
        'Deep purple felt with gold frames. A premium combination.',
        10000, 60, '👑',
        {
            feltColor:   '#4b0082',
            feltDark:    '#2e0054',
            tableGreen:  '#6a0dad',
            gold:        '#ffd700',
            goldDark:    '#c8a830',
            goldBronze:  '#8b6914',
            textWhite:   '#ffffff',
            textWin:     '#66dd88',
            textLoss:    '#ff5566',
            textPrimary: '#ffd700',
            embedColor:  0x4b0082,
        },
    ),

    mocha: colorway('mocha', 'Mocha',
        'Rich espresso felt with creamy latte frames. Warm and smooth.',
        10000, 60, '☕',
        {
            feltColor:   '#2c1a0e',
            feltDark:    '#1a0f08',
            tableGreen:  '#3d2518',
            gold:        '#e8d5c0',
            goldDark:    '#c4a882',
            goldBronze:  '#8c6a48',
            textWhite:   '#f5ede4',
            textWin:     '#88c47a',
            textLoss:    '#d4665a',
            textPrimary: '#e8d5c0',
            embedColor:  0x2c1a0e,
        },
    ),
    banana: colorway('banana', 'Creamy Banana',
        'Soft pale-yellow palette with warm amber accents. A bright, buttery break from the usual darks.',
        15000, 40, '🍌',
        {
            feltColor:   '#fff68f',
            feltDark:    '#c8c05a',
            tableGreen:  '#e8c86a',
            gold:        '#c89a30',
            goldDark:    '#8b6e20',
            goldBronze:  '#5a4818',
            textWhite:   '#2a2010',
            textBlack:   '#000000',
            textWin:     '#2a7a1a',
            textLoss:    '#b0301a',
            textPrimary: '#3e3a21',
            embedColor:  0xffff8f,
        },
        {
            slots: {
                bannerBackground:    '#fff0aa',
                bannerBackgroundEnd: '#e8c86a',
            },
            roulette: {
                textWhite: '#ffffff',
            },
        },
    ),
    washed: colorway('washed', 'Washed Out',
        'A greenish-gray felt with faded, vintage-style frames. A worn-in, nostalgic look.',
        15000, 40, '🎨',
        {
            feltColor:   '#333218',
            feltDark:    '#1a190c',
            tableGreen:  '#4a4930',
            gold:        '#c0c0a0',
            goldDark:    '#808070',
            goldBronze:  '#a0a080',
            textWhite:   '#f0f0e0',
            textWin:     '#88cc88',
            textLoss:    '#cc6666',
            textPrimary: '#c0c0a0',
            embedColor:  0x333218,
        },
    ),
    lilac: colorway('lilac', 'Lilac',
        'Soft purple felt with deep plum accents. Light and whimsical with just enough bite to read clearly.',
        15000, 40, '💜',
        {
            feltColor:   '#c8a0c8',
            feltDark:    '#986098',
            tableGreen:  '#b080b8',
            gold:        '#8a5a9a',
            goldDark:    '#5a3a6a',
            goldBronze:  '#3a2a4a',
            textWhite:   '#2a1a3a',
            textBlack:   '#2a1a3a',
            textWin:     '#2a7a4a',
            textLoss:    '#a03050',
            textPrimary: '#5a3a6a',
            embedColor:  0xc8a0c8,
        },
        {
            slots: {
                bannerBackground:    '#e8d0e8',
                bannerBackgroundEnd: '#c8a0c8',
            },
            roulette: {
                textWhite: '#ffffff',
            },
        },
    ),
    noir: colorway('noir', 'Noir',
        'Classic black felt with white and gray frames. A timeless, elegant look.',
        15000, 40, '🖤',
        {
            feltColor:   '#000000',
            feltDark:    '#000000',
            tableGreen:  '#1a1a1a',
            gold:        '#c0c0c0',
            goldDark:    '#808080',
            goldBronze:  '#a0a0a0',
            textWhite:   '#ffffff',
            textWin:     '#88cc88',
            textLoss:    '#ff6677',
            textPrimary: '#c0c0c0',
            embedColor:  0x000000,
        },
    ),
    crimson: colorway('crimson', 'Crimson',
        'Deep crimson felt with dark red frames and gold accents. A bold yet classic casino look.',
        15000, 40, '🩸',
        {
            feltColor:   '#6b0f1a',
            feltDark:    '#4a0810',
            tableGreen:  '#8b1a28',
            gold:        '#ffd700',
            goldDark:    '#c8a830',
            goldBronze:  '#8b6914',
            textWhite:   '#ffffff',
            textBlack:   '#1a0408',
            textWin:     '#66dd66',
            textLoss:    '#ffb366',
            textPrimary: '#ffd700',
            embedColor:  0x6b0f1a,
        },
    ),
    roseGold: colorway('roseGold', 'Rose Gold',
        'Pink-tinted gold frames on a dark mauve felt. Popular and stylish with a modern, feminine flair.',
        15000, 40, '🌹',
        {
            feltColor:   '#4a2838',
            feltDark:    '#2e1824',
            tableGreen:  '#5a3444',
            gold:        '#e8a59f',
            goldDark:    '#b07670',
            goldBronze:  '#8b4a48',
            textWhite:   '#ffffff',
            textBlack:   '#1a0a14',
            textWin:     '#88dd88',
            textLoss:    '#ff8899',
            textPrimary: '#e8a59f',
            embedColor:  0x4a2838,
        },
    ),
    mint: colorway('mint', 'Mint',
        'Mint-green felt with pastel frames. A fresh, lighthearted theme with a cool, refreshing vibe.',
        15000, 40, '🍃',
        {
            feltColor:   '#2a5a4a',
            feltDark:    '#1a4030',
            tableGreen:  '#3a6a5a',
            gold:        '#b8e8d0',
            goldDark:    '#88b8a0',
            goldBronze:  '#5a8070',
            textWhite:   '#ffffff',
            textBlack:   '#0a1a14',
            textWin:     '#aaffcc',
            textLoss:    '#ff8888',
            textPrimary: '#b8e8d0',
            embedColor:  0x2a5a4a,
        },
    ),
    oliveDrab: colorway('oliveDrab', 'Olive Drab',
        'Military-inspired olive green with khaki and bronze frames. A rugged, utilitarian look with a nod to classic army aesthetics.',
        15000, 40, '🫒',
        {
            feltColor:   '#4a4a28',
            feltDark:    '#2a2a18',
            tableGreen:  '#5a5a30',
            gold:        '#c8b878',
            goldDark:    '#8b7a48',
            goldBronze:  '#5a4a28',
            textWhite:   '#ffffff',
            textBlack:   '#141408',
            textWin:     '#b8cc68',
            textLoss:    '#cc6644',
            textPrimary: '#c8b878',
            embedColor:  0x4a4a28,
        },
    ),
    slate: colorway('slate', 'Slate',
        'A blue-grey slate felt with steel frames sits between classic and modern. A versatile, understated theme with a cool, professional look.',
        15000, 40, '🪨',
        {
            feltColor:   '#2a3a4a',
            feltDark:    '#1a2838',
            tableGreen:  '#3a4a5a',
            gold:        '#c0c8d0',
            goldDark:    '#8a929a',
            goldBronze:  '#5a626a',
            textWhite:   '#ffffff',
            textBlack:   '#0a1218',
            textWin:     '#66dd99',
            textLoss:    '#ff7788',
            textPrimary: '#c0c8d0',
            embedColor:  0x2a3a4a,
        },
    ),


    // ── Test theme ──────────────────────────────────────────────────

    minimal: colorway('minimal', 'Minimal Test',
        'A theme that tests fallbacks by only defining one color.',
        0, 0, '⬛',
        {
            feltColor: '#ff00ff',
        },
    ),
};

// ─────────────────────────────────────────────────────────────────────

/**
 * Get a theme definition by ID. Returns classic if not found.
 */
function getTheme(themeId) {
    return themes[themeId] || themes.classic;
}

/**
 * Get all theme definitions as an array.
 */
function getAllThemes() {
    return Object.values(themes);
}

/**
 * Get a summary list suitable for autocomplete / display.
 */
function getThemeList() {
    return Object.values(themes)
        .filter(t => t.id !== 'minimal')
        .map(t => ({
            id:          t.id,
            name:        t.name,
            description: t.description,
            tier:        t.tier,
            price:       t.price,
            weight:      t.weight,
            emoji:       t.emoji || '',
            availability: t.availability || null,
        }));
}

module.exports = { themes, getTheme, getAllThemes, getThemeList };
