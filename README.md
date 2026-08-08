# Meme Cultist

A Discord bot for the Meme Cult server. Has a full casino economy, an AI chatbot with persistent memory, music playback, and a bunch of fun/image commands.

Built with discord.js v14, powered by [DeepSeek](https://api-docs.deepseek.com/) for the chatbot and [Google Gemini](https://ai.google.dev/) for image understanding and generation.

---

## What's in the box

### 🤖 Chatbot
- AI conversations powered by DeepSeek, with per-channel and per-user persistent memory (rolling summaries + fact extraction)
- Can see images you share (Gemini vision) and read web pages when you drop a link
- Generate images via `/generate` or just ask in chat
- Streaming responses, bookmarks (📌 a message to pin a fact), and a self-critique pass to catch hallucinations
- **Personas** — give the bot a custom character with `/persona`
- **Knowledge base** — store and query channel-specific info with `/kb`
- **Reminders** — set natural-language reminders with `/remind` (backed by a durable job queue, survives restarts)
- Incognito mode, rate limiting, and reply-gated burst protection so it doesn't get spammed to death

### 🎰 Economy & Gambling
The currency is **koku**. You've got a wallet and a bank (earns daily interest at midnight).

**Games:**
- **Blackjack** — hit, stand, double down, split up to 4 hands, late surrender. Persistent hub panel with a Deal button.
- **Video Poker** — five-card draw with a paytable and progressive jackpot. Hub panel with hold buttons.
- **Slots** — canvas-rendered with animated GIFs, themed symbols, free daily spins, near-misses, a full-screen mega win (~1 in 25,000), and a progressive jackpot on 3× WILD.
- **Craps** — multi-player street craps, canvas-rendered felt table, animated dice, pass/come/field/place/hardways/prop bets.
- **Roulette** — multi-player, full table of bet types, button-driven with an idle timeout.
- **Keno** — lottery-style draw. Pick 1–10 spots from 1–80 (or quick-pick), canvas-rendered board, per-spot paytable with a 10,000× top prize.
- **Horse Racing** — win/place/show bets, button-driven betting panel, guild-wide horse stats and a hall of fame on the leaderboard.
- **Duel** — Rock-Paper-Scissors wagers against another user, with escrow, rematch flow, and DM notifications.
- **Coin Flip** — exactly what it sounds like.

All games feed into `/stats` (per-game profit, biggest win/loss, etc.) and `/leaderboard`.

### 🎨 Themes & Shop
- Daily rotating shop with cosmetic items (seeded per-day, so everyone sees the same stock)
- Themes in four tiers: **Colorway** (palette swap), **Styled** (one game reskinned), **Full** (everything), **Limited** (seasonal)
- Themes affect canvas renders for every game — felt, cards, dice, chips, the works

### 🎵 Music
- YouTube playback via discord-player + YoutubeiExtractor
- Queue management, audio filters (bassboost, nightcore, vaporwave, etc.), lyrics via Genius

### 🎲 Fun
- Image commands: `caption`, `memegen`, `speechbubble`, `rip`
- AI image generation, magic 8-ball, dice roller, avatar fetcher, booru search

---

## Setup

### Prerequisites
- Node.js 18+
- FFmpeg (for music)
- A Discord bot token

### 1. Install

```bash
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env` and fill in what you need:

```env
TOKEN=                    # Discord bot token (required)
OPENAI_API_KEY=           # DeepSeek API key (required for chatbot)
GEMINI_API_KEY=           # Google Gemini key (image vision + generation)
COOKIE=                   # YouTube cookies for age-restricted videos (optional)
GENIUS_API_KEY=           # Genius API for /lyrics (optional)
GITHUB_TOKEN=             # GitHub token for /feedback issue creation (optional)
CF_ACCOUNT_ID=            # Cloudflare Workers AI for image generation (optional)
CF_API_KEY=               # Cloudflare API key (optional)
```

There are a bunch of optional tunables too (`STREAMING_ENABLED`, `LOW_BUDGET_MODE`, game timeouts, etc.) — see `.env.example` and `config.js` for all of them.

### 3. Configure

Edit `config.js` with your server's IDs and any feature flags you want to change. Key ones:

| Setting | What it does |
|---------|-------------|
| `CLIENT_ID` / `GUILD_ID` | Your Discord app and server IDs |
| `CHATBOT_ENABLED` | Turn the AI chatbot on/off |
| `CHATBOT_CHANNELS` | Comma-separated channel IDs where the chatbot listens |
| `TESTING_MODE` | Restrict the bot to users with the tester role |
| `CURRENCY_NAME` | Change "koku" to whatever you want |
| `STREAMING_ENABLED` | Stream chatbot responses token-by-token |
| `LOW_BUDGET_MODE` | Caps tool depth and skips self-critique to save API spend |

### 4. Initialize the database

```bash
node bot.js dbinit
```

Run this after pulling any update — it safely backfills new schema fields onto existing users without touching current data.

### 5. Register slash commands

```bash
node bot.js load
```

### 6. Start

```bash
node bot.js          # normal
node bot.js debug    # verbose logging
```

---

## Commands

### Economy

| Command | Description |
|---------|-------------|
| `/balance` | Check your wallet and bank |
| `/daily` / `/weekly` | Claim periodic koku rewards (streak bonus on daily) |
| `/bank deposit/withdraw` | Move koku between wallet and bank |
| `/give` | Send koku to someone |
| `/rob` | 25% chance to steal from a user (5m cooldown) |
| `/beg` | Last resort when you're broke |
| `/leaderboard` | Top 10 by balance, per-game leaderboards, race hall of fame |
| `/stats` | Your full stats dashboard (5 pages) |
| `/jackpot` | Check the current progressive jackpot |

Bet amounts support expressions everywhere: `all`, `half`, `quarter`, `50*2`, `max/3`, etc.

### Gambling

| Command | Description |
|---------|-------------|
| `/blackjack` | Open your blackjack table (or `/blackjack bet:X` to deal immediately) |
| `/poker play` | Open your poker machine (or `/poker play bet:X` to deal immediately) |
| `/slots spin` | Spin the slots (opens a persistent machine panel) |
| `/slots daily` | Free daily spin |
| `/slots paytable` | View payouts |
| `/craps` | Join or start a craps table |
| `/roulette` | Start a roulette session |
| `/keno play` | Pick numbers and bet on the draw (omit `numbers` to quick-pick) |
| `/keno paytable` | View keno payouts and odds |
| `/race start` | Open a race betting panel |
| `/race bet` | Place a bet directly (power-user fast path) |
| `/duel` | Challenge someone to an RPS wager |
| `/flip` | Coin flip |

### Chatbot

| Command | Description |
|---------|-------------|
| `/context set/get/reset` | Configure roleplay options or topic for a channel/thread |
| `/context summary/facts` | Browse what the bot has stored |
| `/refresh` | Reset the bot's context window in this channel |
| `/incognito` | Toggle incognito mode (skips memory) |
| `/persona` | Create, equip, or delete a bot persona |
| `/kb` | Manage the channel knowledge base |
| `/remind set/list/cancel` | Set natural-language reminders |
| `/forget` | Delete a specific fact the bot has stored about you |
| `/whatdoyouknow` | See everything the bot knows about you |
| `/exportmymemory` | Get a JSON export of your facts and summaries via DM |
| `/settings` | Manage your personal bot settings (e.g. DM preferences) |

### Shop & Themes

| Command | Description |
|---------|-------------|
| `/shop browse/buy/preview` | Daily rotating cosmetic shop |
| `/inventory view/equip` | Manage owned items |
| `/theme set/list/info/owned` | Manage casino themes |

### Fun

| Command | Description |
|---------|-------------|
| `/caption` | Add an Impact caption to an image |
| `/memegen` | Classic meme format |
| `/speechbubble` | Slap a speech bubble on anything |
| `/rip` | RIP someone |
| `/generate` | AI image generation |
| `/8ball` | Ask the oracle |
| `/roll` | Roll dice |
| `/avatar` | Get a user's avatar |
| `/booru` | Image booru search |

### Admin

| Command | Description |
|---------|-------------|
| `/db add/delete/set/reset/cleanup` | Manage user DB entries |
| `/koku add/remove/set` | Adjust user balances |
| `/restart` | Restart the bot |
| `/unlockall` | Unlock all items for a user |
| `/feedback` | Submit a bug report or suggestion |

---

## File structure

```
meme-cultist/
├── bot.js                    # Entry point, event handlers, command loader
├── config.js                 # Server config and feature flags
├── database.js               # User schema and DB helpers
├── db/
│   ├── users.sqlite          # Balances, stats, cooldowns, chatbot memory
│   ├── thread_contexts.sqlite # Chatbot context per channel/thread
│   ├── jackpot.sqlite        # Progressive jackpot state
│   ├── jobs.sqlite           # Durable job queue (reminders, async tasks)
│   ├── personas.sqlite       # Persistent bot personas
│   └── feedback.sqlite       # Submitted feedback
├── commands/
│   ├── admin/
│   ├── chatbot/              # context, refresh, incognito, persona, kb, remind, forget...
│   ├── currency/             # balance, bank, games, shop, inventory, theme...
│   ├── fun/
│   ├── general/
│   ├── music/
│   └── nsfw/
├── utils/
│   ├── llm/                  # Provider-agnostic LLM router + adapters (DeepSeek, Gemini, Cloudflare)
│   ├── jobs/                 # Durable job queue
│   ├── kb/                   # Knowledge base store + embeddings
│   ├── messageArchive/       # Chatbot message archive + search
│   ├── personas/             # Persona management
│   ├── reminders/            # Natural-language time parsing
│   ├── openai.js             # Chatbot pipeline (context, memory, facts, summaries)
│   ├── openai-tools.js       # AI function-calling tools
│   ├── schemas.js            # Structured output validation (ajv)
│   ├── cards.js              # Local sprite-based card deck (replaces external API)
│   ├── betModal.js           # Shared bet modal + expression resolver
│   ├── canvasCommon.js       # Shared canvas drawing primitives
│   ├── blackjackCanvas.js    # Blackjack renderer
│   ├── crapsCanvas.js        # Craps felt table renderer
│   ├── duelCanvas.js         # Duel clash screen renderer
│   ├── slotsCanvas.js        # Slots renderer
│   ├── kenoCanvas.js         # Keno board renderer
│   ├── lock.js / userlock.js # Per-key / per-user async mutexes
│   ├── bank.js               # Interest, deposit, withdraw
│   ├── betparse.js           # Bet expression parser
│   ├── ratelimiter.js        # Chatbot turn management + image gen limits
│   ├── ssrf.js               # URL validation
│   └── logger.js             # Console + file logging (logs/YYYY/MM/DD.txt)
├── themes/
│   ├── configs/              # Theme definitions
│   ├── manager.js            # Theme ownership and equipping
│   └── resolver.js           # Four-layer color/sprite resolution
├── schemas/                  # JSON schemas for structured LLM outputs
└── assets/imgs/              # Card spritesheets, game sprites, shared overlays
```

---

## License

MIT — see [LICENSE](LICENSE) for details.
Copyright © 2025 BasboBibbins.
