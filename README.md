# Meme Cultist

A Discord bot for the Meme Cult server, built with discord.js v14. Features include a chatbot powered by DeepSeek API, a currency/gambling system, music playback, and various fun commands.

## Features

### Chatbot
- AI-powered conversations using DeepSeek API (OpenAI SDK v3 compatible)
- **Gemini Vision** — the bot can see and understand images you share (via Google Gemini)
- **URL Context** — the bot reads web pages when you share links
- **Image Generation** — the bot can generate images via `/generate` or by asking in conversation
- Thread-based and channel-based context management
- **Multi-channel support** — chatbot operates across multiple configured channels with per-channel context
- Rolling summaries and fact extraction for persistent memory
- Immediate/real-time fact extraction with debouncing
- User-level memory and statistics tracking
- Roleplay mode with customizable character attributes (`/context set`)
- Admin-only channel context modification, thread owners can customize their own threads
- Paginated viewing of summaries and facts (`/context summary`, `/context facts`)
- Incognito mode for privacy
- Rate limiting per-user and global

### Economy / Gambling
- **Currency**: "koku" - wallet and bank system with daily interest
- **Daily/Weekly Claims**: Random rewards with streak bonuses
- **Bank**: Deposit/withdraw with daily interest at midnight
- **Games**:
  - Blackjack (with double down, splitting up to 4 hands, and late surrender)
  - Slots (canvas-rendered, themed, free daily spins, wild icons, free spin bonus, progressive jackpot)
  - Coin flip (50/50)
  - Roulette (multi-player with betting timer)
  - Horse racing (multi-player with win/place/show bets)
  - Poker (video poker style, progressive jackpot)
  - Craps (experimental)
- **Progressive Jackpot**: Cross-game jackpot fed by slots and poker bets (use `/jackpot` to check)
- **Rob**: Steal from other users (25% success rate, 5min cooldown)
- **Give**: Transfer koku to other users
- **Leaderboard**: Top 10 by bank balance (current and all-time)
- **Net profit tracking**: See your overall profit/loss per game in `/stats`

### Themes & Shop
- **Shop** (`/shop browse/buy/preview`): Rotating daily stock of cosmetic items, seeded per guild per day
- **Inventory** (`/inventory view/equip`): View and equip owned items
- **Themes** (`/theme set/list/info/owned`): Casino visual themes with four tiers:
  - **Colorway** — palette swap
  - **Styled** — one game with custom sprites
  - **Full** — all games with custom sprites
  - **Limited** — seasonal/special themes with availability windows
- Item rarities: Common, Uncommon, Rare, Legendary

### Music
- YouTube playback via discord-player with YoutubeiExtractor
- Queue management (view, clear, shuffle)
- Audio filters (bassboost, nightcore, vaporwave, etc.)
- Lyrics fetching via Genius API
- Volume control and progress bar

### Fun Commands
- Image manipulation: `caption`, `memegen`, `speechbubble`, `rip`
- Image generation: `generate` (AI-generated images via Gemini)
- Random utilities: `8ball`, `choose`, `roll`, `avatar`
- Booru image search (NSFW and safe boorus)

### Admin Tools
- Database management (`/db`)
- Currency management (`/koku`)
- Bot restart (`/restart`)
- User feedback submission with GitHub issue creation

## Prerequisites

- Node.js 18+
- SQLite3 (better-sqlite3)
- FFmpeg (for audio playback)
- Discord bot token
- DeepSeek API key (for chatbot)
- Google Gemini API key (for image understanding and image generation)
- YouTube cookies (optional, for age-restricted videos)
- Genius API key (optional, for lyrics)
- GitHub token (optional, for feedback command)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

Create a `.env` file in the project root:

```env
TOKEN=your_discord_bot_token
OPENAI_API_KEY=your_deepseek_api_key
GEMINI_API_KEY=your_gemini_api_key
COOKIE=your_youtube_cookies_optional
GENIUS_API_KEY=your_genius_api_key_optional
GITHUB_TOKEN=your_github_token_optional
```

### 3. Configuration

Edit `config.json`:

| Field | Description |
|-------|-------------|
| `CLIENT_ID` | Discord application client ID |
| `GUILD_ID` | Server ID for command registration |
| `DEFAULT_ROLE` | Role assigned to new members |
| `BANNED_ROLE` | Role that blocks bot usage |
| `OWNER_ID` | Bot owner's Discord ID |
| `RULES_CHANNEL_ID` | Channel referenced in welcome message |
| `WELCOME_CHANNEL_ID` / `WELCOME_CHANNEL_NAME` | Channel for join messages |
| `RIP_CHANNEL_ID` / `RIP_CHANNEL_NAME` | Channel for leave messages |
| `GITHUB_REPO_OWNER` / `GITHUB_REPO_NAME` | For feedback GitHub issues |
| `APRIL_FOOLS_MODE` | Enable April Fools special behavior |
| `TESTING_MODE` | Restrict bot to testers with TESTING_ROLE |
| `CHATBOT_ENABLED` | Enable/disable AI chatbot |
| `CHATBOT_LOCAL` | Route API to localhost:3000/v1/ |
| `CHATBOT_CHANNELS` | Comma-separated list of chatbot channel IDs |
| `PAST_MESSAGES` | Context window size (default: 15) |
| `SUMMARY_INTERVAL` | Messages before summarizing (default: 25) |
| `FACTS_INTERVAL` | Messages before fact extraction (default: 15) |
| `MAX_FACTS` | Max stored facts per channel/user (default: 25) |
| `MAX_SUMMARIES` | Max summaries kept (default: 3) |
| `OOC_PREFIX` | Prefix to skip chatbot (default: ">") |
| `CHAT_MAX_PROMPT_TOKENS` | Token limit for prompts (default: 6000) |
| `USER_COOLDOWN` | Seconds between chatbot messages (default: 5) |
| `GLOBAL_LIMIT` / `WINDOW_SIZE` | Rate limiting config |
| `CURRENCY_NAME` | Currency display name (default: "koku") |
| `INTEREST_RATE` | Daily bank interest percentage (default: 1) |
| `ROULETTE_*`, `DUEL_*`, `RACE_*` | Game configuration |

### 4. Initialize Database

```bash
node bot.js dbinit
```

### 5. Register Slash Commands

```bash
node bot.js load
```

### 6. Start the Bot

```bash
node bot.js
# or with debug logging:
node bot.js debug
```

## Commands Reference

### Admin Commands

| Command | Description | Options |
|---------|-------------|---------|
| `/db add` | Add database entry for user | `user`, `key?`, `value?` |
| `/db delete` | Delete database entry | `user`, `key?` |
| `/db set` | Set database value | `user`, `key`, `value` |
| `/db reset` | Reset user to defaults | `user` |
| `/db cleanup` | Remove entries for left users | — |
| `/koku add` | Add currency to user's bank | `user`, `amount` |
| `/koku remove` | Remove currency from user | `user`, `amount` |
| `/koku set` | Set user's bank balance | `user`, `amount` |
| `/restart` | Restart the bot (admin only) | — |
| `/unlockall` | Unlock all items for a user (admin only) | `target` |
| `/embed` | Embed an image with title | `image`, `title?` |

### Economy Commands

| Command | Description | Options |
|---------|-------------|---------|
| `/balance` | Check wallet and bank balance | `user?` |
| `/bank deposit` | Deposit koku to bank | `amount` (supports: `all`, `half`, `quarter`, `eighth`, math) |
| `/bank withdraw` | Withdraw koku from bank | `amount` |
| `/daily` | Claim daily koku (24h cooldown, streak bonus) | — |
| `/weekly` | Claim weekly koku (7d cooldown) | — |
| `/give` | Transfer koku to another user | `user`, `amount` |
| `/rob` | Attempt to rob a user (25% success, 5m cooldown) | `user` |
| `/beg` | Beg for koku (only when broke, 25% success) | — |
| `/leaderboard` | View top 10 by balance (current and all-time), per-game profit leaderboards | — |
| `/stats` | View user statistics (5 pages: general, commands, currency, games, chatbot) — includes net profit per game and shop purchase stats | `user?`, `details?` |

### Gambling Commands

| Command | Description | Options |
|---------|-------------|---------|
| `/blackjack` | Play blackjack (supports splitting and late surrender) | `bet` |
| `/slots bet` | Play slot machine | `amount` |
| `/slots daily` | Free daily spin | — |
| `/slots paytable` | View slot payouts | — |
| `/flip` | Coin flip (50/50) | `bet` |
| `/roulette` | Multi-player roulette | `type`, `amount`, `number?` |
| `/race start` | Start a horse race | — |
| `/race bet` | Bet on current race | `horse` (1-8), `amount`, `type?` (`win`/`place`/`show`) |
| `/poker` | Video poker (progressive jackpot) | `bet` (use `paytable` for payouts) |
| `/craps` | Roll dice (experimental) | `bet` |
| `/jackpot` | Check progressive jackpot amount | — |

### Shop & Theme Commands

| Command | Description | Options |
|---------|-------------|---------|
| `/shop browse` | View today's rotating shop stock | — |
| `/shop buy` | Purchase an item from today's shop | `item` (autocomplete) |
| `/shop preview` | Preview an item before buying | `item` (autocomplete) |
| `/inventory view` | View all owned items | — |
| `/inventory equip` | Equip an owned item | `item` (autocomplete) |
| `/theme set` | Equip an owned theme | `theme_name` (autocomplete) |
| `/theme list` | View all available themes | — |
| `/theme info` | Preview a theme's details | `theme_name` (autocomplete) |
| `/theme owned` | View your owned themes | — |

### Chatbot Commands

| Command | Description | Options |
|---------|-------------|---------|
| `/context set` | Set roleplay options / topic (admins for channels, thread owners for threads) | `characteristics?`, `personality?`, `preferences?`, `dialog?`, `boundaries?`, `topic?` |
| `/context get` | View current context data | — |
| `/context summary` | View conversation summaries (paginated) | `scope?` (`channel`/`user`), `page?` |
| `/context facts` | View stored facts (paginated) | `scope?` (`channel`/`user`), `page?` |
| `/context reset` | Reset context to default (same permissions as set) | — |
| `/refresh` | Reset chatbot context point | — |
| `/incognito` | Toggle incognito mode | `scope?` (`channel`/`global`) |

### Music Commands

| Command | Description | Options |
|---------|-------------|---------|
| `/play` | Play a song or playlist | `song` (URL or search query) |
| `/queue view` | View current queue | — |
| `/queue clear` | Clear the queue | — |
| `/queue shuffle` | Shuffle the queue | — |
| `/filter` | Toggle audio filter | `filter` (autocomplete) |
| `/lyrics` | Get lyrics for current/searched song | `song?` |

### Fun Commands

| Command | Description | Options |
|---------|-------------|---------|
| `/8ball` | Magic 8-ball response | `question` |
| `/avatar` | Get user's avatar | `user?` |
| `/caption` | Add Impact caption to image | `text`, `image?`, `user?` |
| `/choose` | Random choice from options | `options` (comma or space separated) |
| `/memegen` | Create meme with top/bottom text | `top?`, `bottom?`, `image?`, `user?` |
| `/rip` | Generate RIP message (admin only) | `user`, `prompt?` |
| `/roll` | Roll dice | `dice?` (sides), `number?` (count) |
| `/speechbubble` | Add speech bubble to image | `image?`, `user?`, `x?`, `y?` |
| `/generate` | Generate an AI image via Gemini | `prompt` (required, max 1000 chars) |
| `/booru` | Search image booru sites | Various subcommands (e6, r34, gelbooru, etc.) |

### General Commands

| Command | Description | Options |
|---------|-------------|---------|
| `/help` | Bot help and command info | `command?` |
| `/ping` | Check bot latency | — |
| `/uptime` | Check bot uptime | — |
| `/stats` | User statistics dashboard | `user?`, `details?` |
| `/feedback` | Submit bug/suggestion/feedback | `type`, `description` |

## Architecture Overview

### File Structure

```
meme-cultist/
├── bot.js                 # Entry point, client setup, event handlers
├── config.js              # Server IDs, feature flags, tuning params
├── database.js            # User DB schema and CRUD helpers
├── package.json           # Dependencies
├── .env                   # Secrets (TOKEN, API keys, etc.)
├── db/
│   ├── users.sqlite       # User data (balance, stats, cooldowns)
│   ├── thread_contexts.sqlite  # Chatbot context/memory
│   ├── jackpot.sqlite     # Progressive jackpot state
│   └── feedback.sqlite    # User feedback storage
├── commands/
│   ├── admin/             # db, koku, unlockall
│   ├── chatbot/           # context, refresh, incognito
│   ├── currency/          # balance, bank, daily, weekly, games, shop, inventory, theme
│   ├── fun/               # 8ball, avatar, caption, memegen...
│   ├── general/           # help, ping, uptime, stats, feedback
│   ├── music/             # play, queue, filter, lyrics
│   └── nsfw/              # booru (image search)
├── themes/
│   ├── configs/           # Theme definitions (index.js, base.js)
│   ├── manager.js          # Theme ownership and equipping logic
│   └── resolver.js         # Theme color/style resolution
├── utils/
│   ├── openai.js           # DeepSeek chatbot logic, memory management
│   ├── openai-tools.js     # Tool functions for AI function calling
│   ├── gemini.js           # Gemini vision (image description) and image generation
│   ├── urlContext.js       # URL extraction and web page text fetching
│   ├── bank.js             # Interest, deposits, withdrawals
│   ├── betparse.js         # Bet string parsing (all, half, math)
│   ├── blackjack.js        # Blackjack game logic (with splitting)
│   ├── poker.js            # Video poker logic
│   ├── roulette.js         # Roulette wheel, table rendering
│   ├── race.js             # Horse racing logic (win/place/show)
│   ├── slots.js            # Slot machine logic
│   ├── slotsCanvas.js      # Canvas rendering for slots
│   ├── slotsThemes.js      # Slot theme color/style mapping
│   ├── inventory.js         # Item ownership, daily shop, equipping
│   ├── jackpot.js           # Progressive jackpot state and interest
│   ├── channels.js         # Chatbot channel helpers
│   ├── Canvas.js           # Image manipulation helpers
│   ├── musicPlayer.js      # discord-player event handlers
│   ├── welcome.js          # Member join/leave messages
│   ├── ratelimiter.js      # Per-user and global rate limiting
│   ├── ssrf.js             # URL validation to prevent SSRF attacks
│   ├── logger.js           # Console + file logging
│   └── ...
└── logs/                   # Daily log files (YYYY/MM/DD.txt)
```

### Key Data Flows

1. **Command Execution**:
   - `bot.js` loads commands from `./commands/` recursively
   - `interactionCreate` handler validates permissions and executes
   - Stats tracked in QuickDB after each command

2. **Chatbot Flow**:
   - Message received → rate limit check → context fetch
   - If image attached: Gemini describes it and passes as vision context (SSRF-protected URL validation)
   - If URL found: page text is fetched and passed as link context (SSRF-protected)
   - Build system prompt (roleplay, topic, facts, summaries)
   - Call DeepSeek API with conversation history + extra context
   - Handle tool calls if model requests them (including `generate_image`)
   - Send response (with any generated image attachments), update message counts
   - Periodically summarize and extract facts
   - Immediate fact extraction with debouncing for real-time learning

3. **Music Playback**:
   - `/play` → search query → discord-player queue
   - Events (trackStart, trackEnd) in `utils/musicPlayer.js`
   - Buttons for pause/skip/stop on "Now Playing" embed

4. **Database Schema** (`users.sqlite`):
   ```js
   {
     id, name, balance, bank, inventory,
     cooldowns: { daily, weekly, rob, freespins },
     stats: {
       commands: { daily, monthly, yearly, total, dailyReset, monthlyReset, yearlyReset },
       dailies: { claimed, currentStreak, longestStreak },
       weeklies: { claimed },
       blackjack: { wins, losses, ties, blackjacks, biggestWin, biggestLoss, profit },
       slots: { wins, losses, jackpots, biggestWin, biggestLoss, profit },
       flip: { wins, losses, biggestWin, biggestLoss, profit },
       roulette: { wins, losses, totalBet, biggestWin, biggestLoss, profit },
       race: { wins, losses, totalBet, biggestWin, biggestLoss, profit },
       poker: { wins, losses, royals, biggestWin, biggestLoss, profit },
       begs: { wins, losses, profit },
       shop: { purchases, spent, biggestPurchase },
       largestBalance, largestBank
     },
     profile: { theme: { equipped, owned } },
     chatbot: { messageCount, summaries, facts, messagesSinceLastSummary, messagesSinceLastFacts, incognitoMode, incognitoChannels }
   }
   ```

### Global Client State

```js
client.slashcommands        // Collection of loaded commands
client.contextResetPoints   // Map<channelId, messageId> for /refresh
client.rouletteGames        // Map<channelId, game> for active roulette
client.raceGames            // Map<channelId, game> for active races
client.immediateFactsDebounce // Map for debouncing immediate fact extraction
client.player              // discord-player instance
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -am 'Add your feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

### Code Style

- Use consistent indentation (2 spaces)
- Follow existing naming conventions
- Add JSDoc comments for complex functions
- Handle errors gracefully with logger

### Testing

Before submitting:
```bash
node bot.js dbinit    # Ensure DB migrations work
node bot.js load      # Test command registration
node bot.js           # Start and verify functionality
```

## License

MIT License - see [LICENSE](LICENSE) for details.

Copyright © 2025 BasboBibbins. Licensed under MIT and CC BY-NC-SA 4.0.