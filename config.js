/**
 * Configuration module for meme-cultist Discord bot.
 * Values are read from environment variables first, then fall back to defaults.
 * Copy .env.example to .env and fill in your values.
 */

const config = {
    // Discord application IDs (must be set in .env)
    CLIENT_ID: process.env.CLIENT_ID || "YOUR_CLIENT_ID_HERE",
    GUILD_ID: process.env.GUILD_ID || "YOUR_GUILD_ID_HERE",

    // Role configuration
    DEFAULT_ROLE: "Peasant",
    BANNED_ROLE: process.env.BANNED_ROLE || "YOUR_BANNED_ROLE_ID_HERE",
    OWNER_ID: process.env.OWNER_ID || "YOUR_OWNER_ID_HERE",
    TESTING_ROLE: process.env.TESTING_ROLE || "YOUR_TESTING_ROLE_ID_HERE",

    // Channel IDs
    RULES_CHANNEL_ID: process.env.RULES_CHANNEL_ID || "YOUR_RULES_CHANNEL_ID_HERE",
    WELCOME_CHANNEL_ID: process.env.WELCOME_CHANNEL_ID || "YOUR_WELCOME_CHANNEL_ID_HERE",
    WELCOME_CHANNEL_NAME: "welcome",
    RIP_CHANNEL_ID: process.env.RIP_CHANNEL_ID || "YOUR_RIP_CHANNEL_ID_HERE",
    RIP_CHANNEL_NAME: "rip",
    CHATBOT_CHANNEL: process.env.CHATBOT_CHANNEL || "YOUR_CHATBOT_CHANNEL_ID_HERE",

    // April Fools configuration
    APRILFOOLS_ROLE: "Fwen",
    APRIL_FOOLS_MODE: false,
    PHANTOM_CHANNEL_CATEGORY: process.env.PHANTOM_CHANNEL_CATEGORY || "YOUR_PHANTOM_CATEGORY_ID_HERE",

    // GitHub configuration
    GITHUB_REPO_OWNER: "basbobibbins",
    GITHUB_REPO_NAME: "meme-cultist",

    // Debug/testing flags
    DEBUG_LOGGING: false,
    TESTING_MODE: false,

    // Chatbot configuration
    CHATBOT_ENABLED: true,
    CHATBOT_LOCAL: false,
    PAST_MESSAGES: 15,
    SUMMARY_INTERVAL: 25,
    FACTS_INTERVAL: 15,
    MAX_FACTS: 25,
    MAX_SUMMARIES: 3,
    FACT_TTL_DAYS: 30, // Days before facts expire (TTL)
    OOC_PREFIX: ">",

    // AI model token limits
    CHAT_MAX_PROMPT_TOKENS: 6000,
    SUMMARY_MAX_PROMPT_TOKENS: 4000,
    INCLUDE_CHANNEL_FACTS_IN_PROMPT: true,
    INCLUDE_USER_FACTS_IN_PROMPT: true,

    // Rate limiting
    USER_COOLDOWN: 5,
    MENTION_COOLDOWN: 60,
    GLOBAL_LIMIT: 30,
    WINDOW_SIZE: 60,

    // Currency/game settings
    CURRENCY_NAME: "koku",
    INTEREST_RATE: 1,
    BLACKJACK_MAX_HANDS: 4,
    ROULETTE_MIN_BET: 10,
    ROULETTE_MAX_BET: 5000,
    ROULETTE_HOUSE_EDGE: 2.7,
    ROULETTE_BETTING_TIME: 15000,
    DUEL_MIN_BET: 50,
    DUEL_COOLDOWN: 300000,
    RACE_MIN_BET: 10,
    RACE_MAX_BET: 1000,
    RACE_BETTING_TIME: 60000,
    RACE_HOUSE_EDGE: 0.10,
    RACE_ANIMATION_TICKS: 10,
    RACE_TICK_INTERVAL: 1500,
    RACE_PLACE_MULTIPLIER: 0.45,
    RACE_SHOW_MULTIPLIER: 0.28,

    // Slots settings
    SLOTS_MAX_LINES: 5,
    SLOTS_NEAR_MISS_CHANCE: 0.15,
    SLOTS_BONUS_FREE_SPINS: 3,
    SLOTS_BONUS_MULTIPLIER: 2,
    SLOTS_DAILY_COOLDOWN: 8.64e7, // 24 hours
    
    // Jackpot settings
    JACKPOT_SEED: 1000000,
    JACKPOT_CONTRIBUTION_RATE: 0.02,
    JACKPOT_MIN_BET: 1000,
    JACKPOT_INTEREST_RATE_PERCENT: 2,

    // Legacy commands list
    LEGACY_COMMANDS: [
        "help",
        "restart",
        "uptime",
        "leave",
        "np",
        "pause",
        "play",
        "queue",
        "remove",
        "repeat",
        "shuffle",
        "skip",
        "skipall",
        "skipto",
        "volume",
        "8ball",
        "avatar",
        "ayy",
        "choose",
        "darkmaga",
        "fbi",
        "fortnite",
        "meme",
        "memegen",
        "normies",
        "oof",
        "owo",
        "quack",
        "rate",
        "safebooru",
        "slots",
        "smuganimegirl",
        "tts",
        "urban",
        "xp",
        "bobs",
        "hentai",
        "rule34"
    ]
};

module.exports = config;