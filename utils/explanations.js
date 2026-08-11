const { CURRENCY_NAME, INTEREST_RATE, CHATBOT_CHANNELS, OOC_PREFIX, BLACKJACK_MAX_HANDS, DUEL_MIN_BET, DUEL_COOLDOWN, JACKPOT_MIN_BET, KENO_MIN_BET, KENO_MAX_BET, KENO_DEFAULT_QUICK_PICK } = require("../config.js");
const { KENO_TOTAL_NUMBERS, KENO_DRAW_COUNT, KENO_MAX_SPOTS } = require("./keno");
const CURRENCY_NAME_CAPITALIZED = CURRENCY_NAME.charAt(0).toUpperCase() + CURRENCY_NAME.slice(1);
const chatbotChannelList = CHATBOT_CHANNELS.map(id => `<#${id}>`).join(", ");

module.exports = {
  currency: {
    name: CURRENCY_NAME_CAPITALIZED,
    description: `
            ${CURRENCY_NAME_CAPITALIZED} is the currency used by the bot. You can earn ${CURRENCY_NAME} in a variety of ways, such as gambling, claiming dailies, and even stealing from other users.
            Spend it on gambling games or on cosmetic items in the daily \`/shop\`.

            There are two places to store your ${CURRENCY_NAME}: your wallet and your bank. Your wallet is where you store the ${CURRENCY_NAME} you spend on things like gambling, and your bank is where you store the ${CURRENCY_NAME} that you want to keep safe.
            You can transfer ${CURRENCY_NAME} from your wallet to your bank and vice versa using \`/bank [deposit|withdraw] [amount]\`. You can also see how much ${CURRENCY_NAME} you have in your wallet and bank using \`/balance\`.
            The ${CURRENCY_NAME} in your bank will earn interest every day. The current interest rate is ${INTEREST_RATE}%.

            To see how much ${CURRENCY_NAME} you have, use \`/balance\`. To see how much ${CURRENCY_NAME} someone else has, use \`/balance @user\`.

            Players can send ${CURRENCY_NAME} to each other using \`/give @user [amount]\`. They will be notified when they receive ${CURRENCY_NAME}.

            You can also beg for ${CURRENCY_NAME} using \`/beg\` when you're broke. There's a 25% chance of receiving a small amount.
            `
  },
  dailyweekly: {
    name: "Dailies and Weeklies",
    description: `
            Dailies and weeklies are a way to earn ${CURRENCY_NAME} every day and week. You can claim your daily and weekly rewards using \`/daily\` and \`/weekly\`, respectively.
            You can only claim these rewards once per day and one per week. You can view your cooldowns by using \`/daily\` and \`/weekly\`.

            Dailies are worth a random amount of ${CURRENCY_NAME} between 100 and 200. You also receive a bonus depending on how many days in a row you have claimed your daily.
            The bonus is a random amount of ${CURRENCY_NAME} between the number of days in a row and 10 times the number of days in a row.
            For example, if you have claimed your daily for 5 days in a row, you will get a bonus of between 5 and 50 ${CURRENCY_NAME}.
            The bonus resets to 0 if you miss a day.

            Weeklies are worth a random amount of ${CURRENCY_NAME} between 500 and 1000. There are no streak bonuses for weeklies.
            `,
    note: `
            Dailies and weeklies are claimable every 24 hours and 7 days, respectively. They do not reset at midnight, but rather at the time you claimed them.`
  },
  blackjack: {
    name: "Blackjack",
    description: `
            Blackjack is a card game where the goal is to get as close to 21 as possible without going over.
            The dealer will give you two cards and you can choose to either hit or stand.
            If you hit, you will be given another card and you can choose to hit or stand again.
            If you stand, you will not be given another card and the dealer will play.
            The dealer will hit until they have at least 17.
            If you go over 21, you bust and lose. If the dealer busts, you win. If you have a higher total than the dealer you win, and if you have a lower total than the dealer you lose.
            If you have the same total as the dealer, it is a tie.

            **Double Down:** Double your bet and receive exactly one more card, then stand. Only available on the first two cards.

            **Split:** If you are dealt two cards of the same value, you can split them into two separate hands, each with their own bet. You can split up to ${BLACKJACK_MAX_HANDS || 4} times.

            **Late Surrender:** After the dealer checks for blackjack, you can choose to surrender and forfeit half your bet, keeping the other half. Useful when you have a weak hand against a strong dealer upcard.
            `,
    rules: `
            1. The goal of blackjack is to beat the dealer's hand without going over 21.
            2. Face cards are worth 10. Aces are worth 1 or 11, whichever makes a better hand.
            3. Each player starts with two cards, one of the dealer's cards is hidden until the end.
            4. To 'Hit' is to ask for another card. To 'Stand' is to hold your total and end your turn.
            5. If you go over 21 you bust, and the dealer wins regardless of the dealer's hand.
            6. If you are dealt 21 from the start (Ace & 10), you got a blackjack.
            7. Blackjack means you win 1.5 the amount of your bet.
            8. Dealer will hit until their cards total 17 or higher.
            9. Doubling is like a hit, only the bet is doubled and you only get one more card.
            10. Splitting is available when your first two cards have the same value. Each split hand gets a new card and plays independently.
            11. Late surrender lets you forfeit half your bet after the dealer checks for blackjack, keeping the other half.`
  },
  slots: {
    name: "Slots",
    description: `
            Slots is a game where you spin a slot machine and try to line up matching symbols across paylines. The game uses canvas-based rendering with visual themes — equip a theme with \`/theme set\` to change how it looks.

            **Wild Icons:** Wild symbols count as any symbol when on an active payline, making it easier to form winning combinations.

            **Free Spins:** Land 3 or more scatter icons to trigger the Free Spin Bonus — you get free spins with no cost to your balance.

            You can see the paytable by using \`/slots paytable\`. Free daily spins are available with \`/slots daily\` (resets at midnight).

            **Progressive Jackpot:** Triple 7s wins the progressive jackpot! The jackpot grows with every bet on both slots and poker. Minimum bet of 10 ${CURRENCY_NAME} to qualify for the jackpot.
            `,
    rules: `
            1. The goal of slots is to line up matching symbols across paylines.
            2. There are 8 symbols, each with a different multiplier — check the paytable for details.
            3. Wild icons count as any symbol on an active payline.
            4. Landing 3+ scatter icons triggers the Free Spin Bonus.
            5. Triple 7s wins the progressive jackpot (minimum ${JACKPOT_MIN_BET.toLocaleString()} ${CURRENCY_NAME} per-line bet required, free spins eligible).
            6. Bets below ${JACKPOT_MIN_BET.toLocaleString()} ${CURRENCY_NAME} per line still contribute to the jackpot but receive a reduced 100x payout for triple 7s.`
  },
  poker: {
    name: "Poker",
    description: `
            Poker is a card game where the goal is to get the best hand possible. This bot uses video poker rules.
            You will be dealt 5 cards and you can choose to keep or discard any number of cards.
            You can then choose to keep or discard any number of cards again. You can keep all 5 cards if you want as well.
            After you are done discarding, you will be given your final hand and you will be paid out based on the paytable.
            You can see the paytable by using \`/poker paytable\`.

            **Progressive Jackpot:** A royal flush wins the progressive jackpot! The jackpot grows with every bet on both slots and poker. Minimum bet of ${JACKPOT_MIN_BET.toLocaleString()} ${CURRENCY_NAME} to qualify.
            `,
    note: `
            1. Aces can be high (above King) or low (in A-2-3-4-5 straight). Straights do not wrap around — only A-high and A-low straights are valid.
            2. Jacks or Better is the minimum hand to win. Pair of Jacks or Better pays 1:1.
            3. With this game being video poker, there is no dealer. You are playing against the machine, not other players.
            4. If you take too long to make a decision, you will be timed out and lose your bet.
            5. Since the probability of getting a good hand is low, the payouts are high. Try small bets at first to get a feel for the game.
            6. The chance of getting a royal flush is 1 in 649,740. It wins the progressive jackpot! Minimum bet of ${JACKPOT_MIN_BET.toLocaleString()} ${CURRENCY_NAME} required. Bets below minimum receive a reduced 50x payout.
            7. Every bet contributes 2% to the progressive jackpot pool.`
  },
  roulette: {
    name: "Roulette",
    description: `
            Roulette is a casino game where players bet on where a ball will land on a spinning wheel. This is European roulette with 37 pockets numbered 0-36.

            Use \`/roulette [type] [amount]\` to place a bet. Multiple players can bet on the same game within the betting period.
            The wheel has 37 pockets: 0 (green) and numbers 1-36 (alternating red and black).

            **Bet Types:**
            • **Straight** - Bet on a single number (0-36). Pays 35:1
            • **Red/Black** - Bet on the color. Pays 2:1
            • **Even/Odd** - Bet on even or odd numbers (0 is neither). Pays 2:1
            • **1-18 (Low)** - Bet on numbers 1-18. Pays 2:1
            • **19-36 (High)** - Bet on numbers 19-36. Pays 2:1
            • **Dozens** - Bet on 1st (1-12), 2nd (13-24), or 3rd (25-36) dozen. Pays 3:1
            • **Columns** - Bet on a vertical column of 12 numbers. Pays 3:1

            **Red Numbers:** 1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36
            **Black Numbers:** 2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35`,
    rules: `
            1. Place your bet using \`/roulette [type] [amount]\`. For straight bets, add the number: \`/roulette straight 100 number:17\`
            2. Other players can join by using the same command before the timer expires
            3. The creator can spin early by clicking "Spin Now" or wait for the timer
            4. Winnings are automatically added to your wallet and you'll receive a DM with results
            5. If 0 lands, all outside bets (red/black, even/odd, etc.) lose
            6. The house edge is 2.7% (from the 0 pocket)`,
    example: `
            \`/roulette straight 500 number:17\` - Bet 500 on number 17 (35:1 payout)
            \`/roulette red 1000\` - Bet 1000 on red (2:1 payout)
            \`/roulette dozen1 200\` - Bet 200 on 1st dozen 1-12 (3:1 payout)
            \`/roulette column3 150\` - Bet 150 on column 3 (3:1 payout)`,
    note: `
            Multiple players can bet on the same game. All bets are pooled and resolved when the wheel spins.
            The betting timer is configured by the server admin. The game creator can spin early using the "Spin Now" button.
            Winnings are sent via DM to keep the channel clean. Check your DMs after the game ends!`
  },
  race: {
    name: "Horse Racing",
    description: `
            Horse racing is a multi-player betting game where you bet on which horse will win the race!
            Each race features 8 horses with randomly generated names, form ratings, and odds.

            Use \`/race start\` to start a new race in the channel. Other players can join using \`/race bet [horse] [amount]\`.
            Each horse has different odds based on their form rating, displayed as:
            • 🟢 **Favorite** - High chance of winning, lower payout
            • 🟡 **Contender** - Medium chance, medium payout
            • 🟠 **Longshot** - Lower chance, higher payout
            • 🔴 **Outsider** - Lowest chance, highest payout

            The race is animated with each horse progressing toward the finish line. First horse to cross wins!

            **Bet Types:**
            • **Win** — Horse must finish 1st. Full odds payout.
            • **Place** — Horse must finish 1st or 2nd. Reduced payout (45% of win odds).
            • **Show** — Horse must finish 1st, 2nd, or 3rd. Further reduced payout (28% of win odds).

            Payouts are calculated as: \`bet × odds × (1 - house edge)\`. The house edge is 5%.`,
    rules: `
            1. Use \`/race start\` to create a new race. Anyone in the channel can then place bets.
            2. Use \`/race bet [horse] [amount]\` to bet on a horse (1-8). You can only place one bet per race.
            3. Use the \`type\` option to choose Win, Place, or Show (default: Win).
            4. Each horse shows odds (e.g., "2.5x") and a chance indicator (Favorite, Contender, Longshot, Outsider).
            5. The race creator can start early with "Start Now" or wait for the betting timer to expire.
            6. Winners receive their payout via DM. The house takes a 5% cut of winnings.
            7. You can only bet from your wallet, not your bank.`,
    example: `
            \`/race start\` - Start a new race (becomes the game host)
            \`/race bet 3 500\` - Bet 500 on horse 3 to win
            \`/race bet 5 300 type:place\` - Bet 300 on horse 5 to place (1st or 2nd)
            \`/race bet 7 all type:show\` - Bet all your wallet on horse 7 to show (1st, 2nd, or 3rd)`,
    note: `
            Only one race per channel at a time. Each player can only bet once per race.
            The winner is pre-determined when the race starts, but the animation shows all horses racing.
            Higher form ratings mean higher probability of winning but lower odds.
            Min/max bet amounts are configured by the server admin.`
  },
  duel: {
    name: "Duel",
    description: `
            Duel is a head-to-head Rock-Paper-Scissors wager between two players. Use \`/duel @user [bet]\` to challenge someone. The challenger's wager is escrowed immediately — the opponent has ${Math.floor(60)} seconds to **Accept** or **Decline** via buttons (and gets a DM with a jump link).

            On accept, the opponent's wallet is checked and their matching wager is escrowed. Both players then pick **🪨 Rock**, **📄 Paper**, or **✂️ Scissors** — choices are hidden until both lock in. Standard RPS rules apply: rock beats scissors, scissors beats paper, paper beats rock.

            **Winner takes the full pot** (both wagers). A **draw** refunds both wagers. If a player doesn't pick in time, the other wins by **forfeit**. If neither picks, both are refunded.

            After the result, either player can click **🔁 Rematch** within 60 seconds — when **both** click, balances are re-checked and the duel restarts on the same message (the cooldown is bypassed by mutual agreement).
            `,
    rules: `
            1. Use \`/duel @user [bet]\` to challenge another player. Minimum bet is ${DUEL_MIN_BET.toLocaleString("en-US")} ${CURRENCY_NAME}.
            2. The challenger's wager is locked up front. The opponent is gated on **bank** balance for the challenge and **wallet** balance at accept time — withdraw via \`/bank\` if your wallet is short.
            3. The opponent must click **Accept Duel** within 60 seconds; otherwise the challenger is refunded.
            4. Both players have 30 seconds to choose Rock, Paper, or Scissors. Choices are hidden until both pick.
            5. Winner takes the full pot. Draw refunds both. Forfeit by timeout awards the pot to whoever did choose.
            6. A standard cooldown of ${Math.floor(DUEL_COOLDOWN / 60000)} minutes is applied to both players after a resolved duel.
            7. The rematch button skips the cooldown when both players click within 60 seconds.`,
    example: `
            \`/duel @rival 500\` — Challenge @rival to a duel for 500 ${CURRENCY_NAME}.
            \`/duel @rival half\` — Wager half your wallet.
            \`/duel @rival all\` — Go all-in.`,
    note: `
            You can't duel yourself or a bot. Only one active duel per challenger/opponent pair per channel at a time.
            The opponent's bank is checked at challenge time so the challenger sees up front whether the opponent could ever cover the wager.
            DM notifications go to the opponent on challenge and to the loser on resolution.`
  },
  music: {
    name: "Music",
    description: `
            This bot has a music player! You can play music by using \`/play [url|search query]\`. It will join your voice channel and play the music you requested.
            If there is already music playing, it will be added to the queue. You can see the queue by using \`/queue view\`.

            The bot uses yt-dlp for YouTube playback, which supports:
            • YouTube videos and playlists
            • SoundCloud tracks and playlists
            • Spotify tracks and playlists (plays YouTube equivalent)
            • Direct links to audio files

            The queue can be shuffled by using \`/queue shuffle\`. You can also clear the queue by using \`/queue clear\`.

            Filters can also be applied to the music. You can see the list of filters by using \`/filter\`.
            You can toggle a filter by using \`/filter [filter name]\`. To turn off all filters, use \`/filter clear\`.

            Playback controls have slash commands as well as buttons on the now playing panel:
            • \`/pause\` and \`/resume\` — hold and continue the current song
            • \`/skip\` — jump to the next song in the queue
            • \`/loop\` — repeat the current song until you turn it off; the queue is kept and resumes afterwards
            • \`/np\` — show what is playing without touching the panel
            • \`/stop\` — stop playback and clear the queue`,
    example: `
            \`/play https://www.youtube.com/watch?v=dQw4w9WgXcQ\`
            \`/play never gonna give you up\`
            \`/play https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT\`
            \`/play https://soundcloud.com/rick-astley-official/never-gonna-give-you-up\``,
    note: `
            The bot will leave your voice channel after the queue is empty. You can also make it leave by pressing the stop button.
            Spotify and Apple Music links play their YouTube equivalent. The song may not sound exactly the same, but it will be the same song.
            Filters are applied to the entire queue. When the queue is cleared, the filters will also be cleared.
            While a song is looping, \`/skip\` still moves to the next song in the queue and the loop carries over to it. Turn the loop off to let the queue play through normally.
            For age-restricted YouTube videos, the bot owner can configure cookies in a \`.cookies\` file.`,
  },
  shop: {
    name: "Shop",
    description: `
            The shop sells cosmetic items (themes today, more later) in exchange for ${CURRENCY_NAME}.

            Each server has its own stock of items that **rotates every day at midnight UTC**. Use \`/shop browse\` to see what's available today, \`/shop preview <item>\` to see an item's details before buying, and \`/shop buy <item>\` to purchase it.

            Items are grouped by **rarity**:
            • **Common** \u2014 shows up often, usually cheap colorways
            • **Uncommon** \u2014 rotates in less frequently
            • **Rare** \u2014 high-effort themes that rarely appear
            • **Legendary** \u2014 only occasionally spotted in the wild

            Once bought, items go to your \`/inventory\` and are yours forever. The daily rotation only controls *what you can buy today*, not what you can use.

            **Progressive Jackpot:** Slots and poker contribute to a shared progressive jackpot. Triple 7s on slots (minimum ${JACKPOT_MIN_BET.toLocaleString()} ${CURRENCY_NAME} per-line) or a royal flush on poker (minimum ${JACKPOT_MIN_BET.toLocaleString()} ${CURRENCY_NAME}) wins it.
            `,
    note: `
            The shop resets at 00:00 UTC. Different servers see different stocks \u2014 two servers on the same day will have different lineups.`
  },
  inventory: {
    name: "Inventory",
    description: `
            Your inventory holds every item you own across every category (themes today, more later). Use \`/inventory view\` to see everything you own, grouped by category and rarity.

            Use \`/inventory equip <item>\` to equip an item. For themes specifically, \`/theme set <theme>\` does the same thing \u2014 they share code, pick whichever feels natural.

            You can only own each item once; the shop will tell you if an item is already yours.
            `,
  },
  theme: {
    name: "Themes",
    description: `
            Themes change the visual style of casino games (slots, roulette, poker, etc.). Use \`/theme list\` to see all available themes, \`/theme info <theme>\` to preview one, and \`/theme set <theme>\` to equip a theme you own.

            Themes come in four tiers:
            • **Colorway** \u2014 swaps the color palette of the default layout
            • **Styled** \u2014 customizes one game with unique colors and sprites
            • **Full** \u2014 reskins all games with custom colors, sprites, and backgrounds
            • **Limited** — seasonal or special themes that are only available during specific time windows

            Themes are purchased in the daily \`/shop\`. Once you own a theme, it's yours forever \u2014 equip and swap as often as you like.
            `,
    note: `
            The "Classic" theme is always available and free. New themes rotate through the shop, so check back daily.
            Higher-tier themes (Styled, Full) include more custom artwork and game-specific overrides.
            Limited themes only appear in the shop during their availability window — once it ends, they can't be purchased.`
  },
  jackpot: {
    name: "Progressive Jackpot",
    description: `
            The progressive jackpot is a shared prize pool that grows with every qualifying bet on slots and poker.

            • Every bet contributes 2% to the jackpot pool
            • **Slots:** Triple 7s wins the jackpot (minimum ${JACKPOT_MIN_BET.toLocaleString()} ${CURRENCY_NAME} per-line bet required)
            • **Poker:** A royal flush wins the jackpot (minimum ${JACKPOT_MIN_BET.toLocaleString()} ${CURRENCY_NAME} bet required)
            • Bets below the minimum still contribute to the jackpot but receive a reduced fixed payout instead
            • The jackpot also earns daily interest, growing even when no one is playing

            Use \`/jackpot\` to check the current jackpot amount and last winner.
            `,
    note: `
            The jackpot starts at 1,000,000 ${CURRENCY_NAME} if it ever resets. A minimum bet of ${JACKPOT_MIN_BET.toLocaleString()} ${CURRENCY_NAME} is required for full jackpot eligibility — per line on slots, flat on poker.`
  },
  chatbot: {
    name: "Chatbot",
    description: `
            Sending a message in a chatbot channel will start a conversation with the bot. The bot operates across multiple channels, each with their own context.
            The bot is designed to have open-ended conversations that are engaging and interactive. You can use it to ask questions, share information, or just chat with the bot.

            Threads, public or private, can be used in ${chatbotChannelList} to create a more personalized conversation with the bot.
            Each thread has its own context and history, which will update as you interact with the bot in that thread.

            The \`/context\` command lets you view and manage chatbot context — channel context can only be modified by admins, while thread owners can customize their own thread context. Summaries and facts are paginated when viewing.
            For more information, type \`/help context\`.
        `,
    note: `
            As this is a ChatGPT-like model, it's important to keep in mind that the bot ***may not always respond as expected or accurately***.

            The bot reacts to any message within ${chatbotChannelList}, meaning there is no need to mention the bot.

            Responses are generated based on how you communicate with it. Previous messages are used as context, alongside context saved based on your interactions and settings.

            If you want to say something out-of-character that the bot doesn't use or react to, prefix your message with "${OOC_PREFIX}" and the bot will ignore it completely.

            Modifying the thread context is completely optional; the bot will generate summaries, facts, and topics automatically based on your interactions. Facts are extracted both periodically from summaries and in real-time as you chat.
            If you want your thread to be more roleplay-focused, modify the settings tagged **[RP]** when using \`/context set\`.

            The bot may reject or defer your request if it's in violation of **[Deepseek Terms of Use](https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html)**.
            There are no explicit rules to using the bot; just keep in mind your request can be rejected if it isn't kosher ;)
           `,
    example: `
            **[Example 1 - Basic Conversation]**
            Basbo: Hey, how's it going?
            Chatbot: Hey Basbo! Doing great, thanks for asking. What's up with you?
            Basbo: Just looking to talk with my best bud 🙂
            Chatbot: Aw, you're making me smile! Always happy to chat with my best bud Basbo. What's on your mind today? 😊

            **[Example 2 - Question and Answer]**
            Basbo: Give me your top 5 favorite Minecraft blocks to build with.
            Chatbot: Sure thing! Here are my top 5 favorite Minecraft blocks to build with:
            -Stone Brick
            -Spruce Planks
            -Andesite
            -Terracotta
            -Netherrack
            Basbo: That's an... interesting list. What's your favorite block to build with?
            Chatbot: My favorite block to build with is stone brick! It's versatile, easy to farm, and pairs well with other blocks!

            **[Example 3 - Roleplay]**
            Basbo: You are roleplaying as a woman I have a crush on. I finally worked up the courage to ask you out.
            Basbo: "Do you think there is something more between us?"
            Chatbot: "I've been thinking about that too. I like being around you—more than just a friend would. Maybe we've both been waiting for the right moment?"
        `
  },
  craps: {
    name: "Craps",
    description: `
            Street-style craps: one shooter throws two dice, everyone else bets on the outcome. Each round starts with a "come-out" roll.

            **Come-out roll:**
            • Roll **7** or **11** → Pass Line wins immediately.
            • Roll **2**, **3**, or **12** → Pass Line loses ("craps").
            • Any other roll (**4, 5, 6, 8, 9, 10**) sets the **point**.

            **Point phase:**
            The shooter keeps rolling until the point repeats (Pass wins) or a **7** comes first (Pass loses — "seven-out" — and the dice pass to the next player).

            **Bets:**
            • **Pass Line** — bet with the shooter. Pays 1:1. Come-out only.
            • **Don't Pass** — bet against the shooter. Pays 1:1, but 12 on come-out is a push. Come-out only.
            • **Field** — one-roll bet that wins on 3/4/9/10/11 (1:1), 2 (2:1), or 12 (3:1).
            • **Any 7** — one-roll bet, pays 4:1 on a 7.
            • **Any Craps** — one-roll bet, pays 7:1 on 2, 3, or 12.

            Use \`/craps play\` to start a session and \`/craps paytable\` to see the payouts.
            `,
    rules: `
            1. Start a session with \`/craps play\`. The first player becomes the shooter; the message is the channel's table.
            2. Anyone can place a bet by pressing the bet buttons on the session message. A modal will ask for an amount the first time; after that your last amount is reused automatically.
            3. Only the shooter can press **Roll**. The shooter can also press **Pass Dice** to hand the dice to the next player voluntarily. The dice pass automatically when the shooter sevens out.
            4. Pass / Don't Pass can only be placed during the come-out roll. Field / Any 7 / Any Craps can be placed any time.
            5. One-roll bets (Field, Any 7, Any Craps) resolve every roll. Pass / Don't Pass stay across the come-out → point transition until they win or lose.
            6. Only the player who started the session can press **End Session** — that refunds all standing bets.
            7. Sessions idle out after 5 minutes of no rolls — standing bets are refunded automatically.
            8. One session per channel.`,
    example: `
            \`/craps play\` — Start a new craps session in this channel.
            \`/craps paytable\` — Show the payout table as a canvas image.`,
    note: `
            Pass / Don't Pass placements are rejected once a point is set — wait for the come-out roll.
            The shooter rotates on a seven-out (in join order), or voluntarily via the Pass Dice button.
            Craps contributes to the progressive jackpot at the same rate as other games.`
  },
  keno: {
    name: "Keno",
    description: `
            Keno is a lottery-style draw. You pick between 1 and ${KENO_MAX_SPOTS} numbers ("spots") from a board of 1–${KENO_TOTAL_NUMBERS}, then the machine draws ${KENO_DRAW_COUNT} numbers at random. You are paid on how many of your picks appear in the draw.

            **Picking numbers:**
            • \`/keno play bet:100 numbers:3, 17, 29\` — play those exact numbers.
            • \`/keno play bet:100 spots:8\` — let the bot quick-pick 8 numbers for you.
            • \`/keno play bet:100\` — quick-picks ${KENO_DEFAULT_QUICK_PICK} numbers.

            **Getting paid:**
            Each payout is a multiplier that **replaces your stake**, so 1x is your money back and 0x is a loss. How many matches you need depends on how many numbers you picked — a 3-spot ticket pays on 2 matches, while a 10-spot ticket needs 4 before anything happens, but pays far more at the top end.

            More spots does not mean better odds; it trades a lower chance of any payout for a much larger ceiling. Every spot count returns roughly the same amount over time, so pick the shape of risk you prefer.

            Use \`/keno paytable\` to see every payout, or \`/keno paytable spots:10\` for one row with the odds of each match count.
            `,
    rules: `
            1. Pick 1–${KENO_MAX_SPOTS} numbers between 1 and ${KENO_TOTAL_NUMBERS}. Numbers may be separated by commas or spaces, and cannot repeat.
            2. ${KENO_DRAW_COUNT} of the ${KENO_TOTAL_NUMBERS} numbers are drawn at random, without replacement.
            3. Your payout is looked up by (numbers picked, numbers matched) in the paytable.
            4. Payouts replace your stake rather than adding to it: at 1x you break even, above 1x you profit.
            5. Bets range from ${KENO_MIN_BET.toLocaleString("en-US")} to ${KENO_MAX_BET.toLocaleString("en-US")} ${CURRENCY_NAME}, and accept the same expressions as other games (\`half\`, \`max / 2\`, and so on).
            6. Every round is independent — past draws tell you nothing about the next one.`,
    example: `
            \`/keno play bet:500 numbers:4, 11, 23, 37, 58\` — Play five chosen numbers for 500 ${CURRENCY_NAME}.
            \`/keno play bet:max spots:10\` — Quick-pick ten numbers for your whole balance.
            \`/keno paytable spots:5\` — Show payouts and odds for a five-spot ticket.`,
    note: `
            Rounds where you get exactly your stake back are tracked separately from wins and losses in \`/stats\`.
            Keno does not contribute to the progressive jackpot.`
  },
  reminder: {
    name: "Reminders",
    description: `
            Set reminders so the bot pings you later. You can use the slash command \`/remind\` or just ask the chatbot directly ("remind me in 2 hours to check the oven").

            **Slash command:**
            • \`/remind add when:\"in 30 minutes\" message:\"stretch\"\` — set a new reminder
            • \`/remind add when:\"tomorrow at 8pm\" message:\"walk the dog\" frequency:daily end_date:\"in 2 weeks\"\` — recurring reminder
            • \`/remind add when:\"in 10 minutes\" message:\"meeting\" target:@User\` — group reminder
            • \`/remind list\` — show your pending reminders
            • \`/remind cancel id:<ID>\` — cancel a reminder by its ID

            The bot tries to DM each recipient first. If DMs are closed, it falls back to the channel where the reminder was set.
        `,
    rules: `
            1. Natural-language time works: "in 2 hours", "tomorrow at 3pm", "next tuesday", "5 minutes from now".
            2. You can have up to 10 active reminders at once.
            3. Reminders persist across bot restarts.
            4. If the bot can't reach you (DMs closed and channel gone), the reminder is dropped and logged.
            5. Group reminders can target a user or a role. Role targets are resolved to individual DMs for each member.
            6. Recurring reminders repeat daily or weekly. Cancelling the pending job breaks the chain — no future instances fire.`
  },
  kb: {
    name: "Knowledge Base",
    description: `
            A per-server knowledge base the chatbot can search and cite. Admins curate the entries; anyone can read or search them.

            **Slash command:**
            • \`/kb add slug:<id> title:"…" content:"…" tags:"a,b"\` — add an entry (admin only)
            • \`/kb edit slug:<id> [title|content|tags]\` — edit an entry (admin only)
            • \`/kb delete slug:<id>\` — remove an entry (admin only)
            • \`/kb list\` — list all entries in this server
            • \`/kb search query:"…"\` — semantic search across entries

            **From chat:** the bot can call the \`lookup_kb\` tool automatically when you ask "what did we decide about X" or "is there a doc on Y" — it returns the highest-scoring entry.
        `,
    rules: `
            1. Slugs are short identifiers: 1-64 lowercase letters, digits, or hyphens.
            2. Titles cap at 100 characters; entry content caps at 4000 characters.
            3. Add/edit/delete are admin-gated using the same rule as \`/koku\`: the bot owner can always use them, and guild administrators can if \`ADMIN_COMMANDS_OWNER_ONLY\` is false.
            4. New and edited entries are embedded asynchronously by a background job, so semantic search may take a few seconds to reflect changes.
            5. List and search are public — every member can read entries.
            6. Entries are scoped to the server they were created in.`,
    note: `
            Use the KB for stable, shared facts (rules, role guides, server lore, recurring how-tos). For personal preferences, use the chatbot's user memory (\`/whatdoyouknow\`, \`/forget\`) instead.`
  },
  directives: {
    name: "Standing Instructions",
    description: `
            Standing instructions are rules the chatbot must follow in a channel from now on — "never spoil the Wordle answer, give hints instead", "keep replies under three sentences". Unlike the facts the bot picks up about you, they never expire and survive \`/refresh\` and restarts.

            **Slash command:**
            • \`/directives add instruction:"…"\` — add a rule (Manage Channels)
            • \`/directives list\` — show the rules active in this channel
            • \`/directives remove directive:<rule>\` — remove a rule (Manage Channels)

            **From chat:** just tell the bot. Phrasing like "from now on…", "never…", "always…" is picked up automatically and stored — the bot will confirm. Retract one the same way ("you can talk about spoilers again").
        `,
    rules: `
            1. Instructions are channel-wide: a rule set by one person applies to everyone talking in that channel.
            2. Up to 10 per channel. Adding an 11th drops the oldest.
            3. Instructions outrank a conflicting later request — if you ask for something a rule forbids, the bot honors the rule and offers what it can.
            4. Near-duplicates are merged rather than stacked.
            5. Threads keep their own instructions, separate from the parent channel.
            6. \`/directives list\` is open to everyone; adding and removing needs Manage Channels, or ask the bot in chat.`,
    note: `
            Use standing instructions for how the bot should *behave*. For things it should *know* about you, let it learn them in conversation and review them with \`/whatdoyouknow\`.`
  },
  aifeatures: {
    name: "AI Features",
    description: `
            The chatbot has additional AI capabilities powered by Google Gemini:

            **Image Vision** — Attach an image in a chatbot channel and the bot will see and understand it. Include text with your image to give the bot a hint (e.g., "What's wrong with this screenshot?"). The bot reacts as if it opened the image itself — it won't say "based on the description."

            **URL Context** — Share a link and the bot will automatically read the page content so it can discuss it with you. It works for any HTML page — articles, docs, blogs, etc. The bot references the content naturally as if it read the page.

            **Image Generation** — Generate AI images two ways: use \`/generate [prompt]\` as a slash command, or ask the chatbot directly in conversation ("draw me a cat"). Prompts can be up to 1000 characters.
        `,
    note: `
            Vision and image generation require a Gemini API key. If it's not configured, the bot will let you know rather than pretending.

            For URL context: only the first URL per message is fetched. Non-HTML content is skipped. Pages larger than 2MB or with text exceeding 4000 characters are truncated. Fetch requests time out after 8 seconds.

            For image generation: the chatbot only triggers on direct, explicit requests to create an image, not casual mentions or metaphorical uses of "imagine."
        `
  },
  persona: {
    name: "Personas",
    description: `
            Personas let you create reusable custom voices for the chatbot. Instead of changing the bot's behavior one message at a time, you can define a persistent identity and pin it to any channel or thread.

            **Creating a persona:**
            Use \`/persona create name:my-persona prompt:"You are a sarcastic pirate." public:true\`
            • **name** — lowercase letters, numbers, and hyphens only; 1–32 characters.
            • **prompt** — the system prompt that tells the bot how to behave (up to 2000 characters). Be specific: personality, tone, knowledge boundaries, and how it should refer to itself.
            • **public** — \`true\` lets anyone in the server use it; \`false\` restricts it to you.

            **Using a persona:**
            \`/persona use name:my-persona\` pins it to the current channel or thread. The bot will adopt that voice for all messages in that context until you clear it.

            **Managing personas:**
            • \`/persona list\` — see all personas in the server and which one is pinned here.
            • \`/persona clear\` — remove the pinned persona and return to the default voice.
            • \`/persona edit\` — update the prompt or visibility of a persona you own.
            • \`/persona delete\` — permanently remove a persona you own.
        `,
    rules: `
            1. Personas are scoped to the server they were created in.
            2. You can only edit or delete personas you created. Server admins and the bot owner can also modify any persona.
            3. Private personas can only be pinned by their creator (or the bot owner).
            4. A persona pinned to a channel stays active until \`/persona clear\` is used or the persona is deleted.
            5. If a pinned persona is deleted, channels that had it will fall back to the default bot voice automatically.
            6. Personas override thread-level roleplay settings from \`/context set\` — the persona prompt takes priority.`,
    note: `
            Personas work in both regular chatbot channels and threads. Each channel/thread can have its own pinned persona.
            For best results, write prompts that describe the persona's personality, speech patterns, and boundaries rather than scripting specific responses.
            The prompt becomes part of the system message sent to the LLM on every turn, so keep it concise and focused.`
  }
};