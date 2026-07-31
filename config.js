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
  CHATBOT_CHANNELS: (process.env.CHATBOT_CHANNELS || process.env.CHATBOT_CHANNEL || "YOUR_CHATBOT_CHANNEL_ID_HERE")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean),

  // Admin configuration
  ADMIN_COMMANDS_OWNER_ONLY: true, // true = only OWNER_ID can use admin commands, false = users with 'administrator' permission can use admin commands

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
  CONVO_MODEL: process.env.CONVO_MODEL || "deepseek-v4-flash",
  PAST_MESSAGES: 15,
  MAX_API_MESSAGES: 45,

  // History window anchoring. A window that slides by one message every turn
  // breaks the prompt cache immediately after the system message, so the oldest
  // message is instead pinned and the window grows until it hits the ceiling —
  // turning a miss every turn into a miss every (MAX - MIN) turns.
  HISTORY_ANCHOR_ENABLED: true,
  HISTORY_MIN_MESSAGES: 15,
  HISTORY_MAX_MESSAGES: 30,
  HISTORY_FETCH_LIMIT: 60,

  // Custom emoji listed in the prompt roster.
  EMOJI_BLOCK_CAP: 25,

  // Replayed side-effect tool results are truncated: an uncapped image or KB
  // payload can dominate the history window.
  TOOL_RESULT_REPLAY_CHARS: 400,
  SUMMARY_INTERVAL: 25,
  FACTS_INTERVAL: 15,
  TOPIC_UPDATE_INTERVAL: 20,
  MAX_FACTS: 25,
  MAX_SUMMARIES: 3,
  FACT_TTL_DAYS: 30, // Days before facts expire (TTL)
  OOC_PREFIX: ">",

  // AI model token limits. CHAT_MAX_PROMPT_TOKENS now covers the tool schema
  // too (~3k tokens), which the estimator previously ignored entirely.
  CHAT_MAX_PROMPT_TOKENS: 10000,
  SUMMARY_MAX_PROMPT_TOKENS: 4000,
  INCLUDE_CHANNEL_FACTS_IN_PROMPT: true,
  INCLUDE_USER_FACTS_IN_PROMPT: true,

  // Event-driven fact extraction
  IMMEDIATE_FACTS_ENABLED: true,
  IMMEDIATE_FACTS_MIN_LENGTH: 10,
  IMMEDIATE_FACTS_DEBOUNCE_MS: 60000,
  MAX_FACTS_IN_PROMPT: 15,
  FACT_CONFIDENCE_THRESHOLD: 2,

  // Standing directives — persistent behavioral rules a channel has asked the
  // bot to follow. Unlike facts these never expire and are never compressed.
  DIRECTIVES_ENABLED: true,
  MAX_DIRECTIVES: 10,
  DIRECTIVE_MAX_LENGTH: 300,

  // Weight of lexical relevance-to-current-turn in fact selection. The
  // remaining weight is split between reinforcement and recency. Set to 0 to
  // restore purely score-based selection.
  FACT_RELEVANCE_WEIGHT: 0.5,

  // Deterministic knowledge-base pre-flight: lexical (no embedding call) match
  // of each inbound turn against KB titles/tags/content, injected into the
  // prompt so the model does not have to spend a lookup_kb tool call.
  KB_PREFLIGHT_ENABLED: true,
  KB_PREFLIGHT_MIN_SCORE: 0.25,
  KB_PREFLIGHT_MAX_ENTRIES: 2,
  KB_PREFLIGHT_CONTENT_CHARS: 400,

  // Per-channel ring of recent image/link descriptions, kept in memory only so
  // image-only messages (which carry no text and are dropped from history)
  // remain visible on follow-up turns.
  PERCEPTION_CACHE_SIZE: 5,
  PERCEPTION_CACHE_TTL_MS: 3600000,

  // Rate limiting
  MENTION_COOLDOWN: parseInt(process.env.MENTION_COOLDOWN || "60", 10),
  IMAGE_GEN_LIMIT: 5,
  IMAGE_GEN_WINDOW: 1800, // seconds (30 minutes)
  MENTION_LIMIT: 3,
  MENTION_WINDOW: 3600, // seconds (1 hour)

  // Chatbot-channel throttle (reply-gated + rolling burst cap).
  // In-flight timeout protects against a handler that threw or a restart
  // mid-turn so a user is never permanently locked out.
  CHAT_INFLIGHT_TIMEOUT_MS: parseInt(process.env.CHAT_INFLIGHT_TIMEOUT_MS || "120000", 10),
  CHAT_BURST_LIMIT: parseInt(process.env.CHAT_BURST_LIMIT || "12", 10),
  CHAT_BURST_WINDOW_MS: parseInt(process.env.CHAT_BURST_WINDOW_MS || "300000", 10),

  // Currency/game settings
  CURRENCY_NAME: "koku",
  INTEREST_RATE: 1,
  BLACKJACK_MAX_HANDS: 4,
  ROULETTE_MIN_BET: 10,
  ROULETTE_MAX_BET: 0, // default 5000
  ROULETTE_HOUSE_EDGE: 2.7,
  ROULETTE_IDLE_TIMEOUT: 120000,
  DUEL_MIN_BET: 50,
  DUEL_COOLDOWN: 300000,
  RACE_MIN_BET: 100,
  RACE_MAX_BET: 0, // default 1000
  RACE_BETTING_TIME: 60000,
  RACE_HOUSE_EDGE: 0.05,
  RACE_ANIMATION_TICKS: 10,
  RACE_TICK_INTERVAL: 2000,
  RACE_PLACE_MULTIPLIER: 0.45,
  RACE_SHOW_MULTIPLIER: 0.28,

  // Shared panel idle timeout (blackjack, poker, slots hub panels)
  PANEL_IDLE_TIMEOUT: 5 * 60 * 1000, // 5 min idle -> session ends

  // Craps settings
  CRAPS_MIN_BET: 10,
  CRAPS_MAX_BET: 0, // 0 = no cap
  CRAPS_ROUND_TIMEOUT: 5 * 60 * 1000, // 5 min idle -> refund + end
  CRAPS_ANIMATION_HOLD_MS: 1100,

  // Slots settings
  SLOTS_MAX_LINES: 5,
  SLOTS_NEAR_MISS_CHANCE: 0.10,
  SLOTS_BONUS_FREE_SPINS: 3,
  SLOTS_BONUS_MULTIPLIER: 2,
  SLOTS_DAILY_COOLDOWN: 8.64e7, // default: 24 hours = 8.64e7
  SLOTS_DAILY_FREE_SPINS: 5,
  SLOTS_DAILY_BET: 50,
  SLOTS_DAILY_LINES: 3,
  SLOTS_FULLSCREEN_CHANCE: 0.00004, // 1 in 25,000 paid spins, default 0.00004
  SLOTS_FULLSCREEN_MULTIPLIER: 500, // payout = bet * lines * multiplier

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
  ],

  // Cloudflare Workers AI credentials (used by utils/llm/adapters/cloudflare.js)
  CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID || "",
  CF_API_KEY: process.env.CF_API_KEY || "",

  // Brave Search API (used by the web_search tool in utils/openai-tools.js)
  BRAVE_API_KEY: process.env.BRAVE_API_KEY || "",

  // LLM provider layer (utils/llm/)
  LLM_DEFAULT_TIMEOUT_MS: parseInt(process.env.LLM_DEFAULT_TIMEOUT_MS || "60000", 10),
  LLM_MAX_RETRIES: parseInt(process.env.LLM_MAX_RETRIES || "3", 10),
  // Per-chunk inactivity watchdog for streaming completions. Lower than the
  // overall LLM timeout because once chunks are flowing, a 30s gap is already
  // pathological.
  LLM_STREAM_IDLE_TIMEOUT_MS: parseInt(process.env.LLM_STREAM_IDLE_TIMEOUT_MS || "30000", 10),

  // Durable job queue (utils/jobs/)
  JOB_TICK_MS: parseInt(process.env.JOB_TICK_MS || "2000", 10),
  JOB_BATCH_SIZE: parseInt(process.env.JOB_BATCH_SIZE || "5", 10),
  JOB_DB_PATH: process.env.JOB_DB_PATH || "db/jobs.sqlite",

  // Persistent personas (utils/personas/)
  PERSONA_DB_PATH: process.env.PERSONA_DB_PATH || "db/personas.sqlite",

  // Message archive retention (utils/messageArchive/). Pruned daily by the
  // midnight job in bot.js. Both axes are independent: rows older than
  // ARCHIVE_RETENTION_DAYS are dropped first, then each channel is trimmed
  // down to ARCHIVE_MAX_ROWS_PER_CHANNEL most-recent rows. Set either to 0
  // to disable that axis.
  ARCHIVE_RETENTION_DAYS: parseInt(process.env.ARCHIVE_RETENTION_DAYS || "90", 10),
  ARCHIVE_MAX_ROWS_PER_CHANNEL: parseInt(process.env.ARCHIVE_MAX_ROWS_PER_CHANNEL || "10000", 10),
  // Minimum archived chunks per channel before the 6h compaction job converts
  // the oldest SUMMARY_INTERVAL-sized window into an episode entry.
  ARCHIVE_COMPACTION_THRESHOLD: parseInt(process.env.ARCHIVE_COMPACTION_THRESHOLD || "100", 10),
  // Minimum cosine similarity an episode must clear in recall_episode's semantic
  // fallback (the branch taken when FTS finds no keyword match). Without a floor
  // the closest-ranked episodes are always returned, so unrelated queries surface
  // irrelevant episodes instead of an empty "no record" result. Measured noise
  // sits ~0.51 and genuine matches ~0.58, so 0.55 separates them.
  EPISODE_RECALL_MIN_SCORE: parseFloat(process.env.EPISODE_RECALL_MIN_SCORE || "0.55"),

  // Polish-milestone toggles
  LOW_BUDGET_MODE: /^(1|true|yes|on)$/i.test(process.env.LOW_BUDGET_MODE || ""),
  CRITIQUE_MODEL: process.env.CRITIQUE_MODEL || "deepseek-reasoner",
  BOOKMARK_EMOJI: process.env.BOOKMARK_EMOJI || "📌",
  STREAMING_ENABLED: /^(1|true|yes|on)$/i.test(process.env.STREAMING_ENABLED || ""),

  // Reminders
  REMINDER_MAX_ACTIVE_PER_USER: parseInt(process.env.REMINDER_MAX_ACTIVE_PER_USER || "10", 10),
  REMINDER_DM_FALLBACK: /^(1|true|yes|on)$/i.test(process.env.REMINDER_DM_FALLBACK || "1"),
  REMINDER_MAX_GROUP_SIZE: parseInt(process.env.REMINDER_MAX_GROUP_SIZE || "25", 10),
};

module.exports = config;
