const { CURRENCY_NAME, INTEREST_RATE } = require('../config.json');
const CURRENCY_NAME_CAPITALIZED = CURRENCY_NAME.charAt(0).toUpperCase() + CURRENCY_NAME.slice(1);

module.exports = {
    currency: {
        name: CURRENCY_NAME_CAPITALIZED,
        description: `
            ${CURRENCY_NAME_CAPITALIZED} is the currency used by the bot. You can earn ${CURRENCY_NAME} in a variety of ways, such as gambling, claiming dailies, and even stealing from other users.
            It currently has no use outside of gambling, but that will change in the future!

            There are two places to store your ${CURRENCY_NAME}: your wallet and your bank. Your wallet is where you store the ${CURRENCY_NAME} you spend on things like gambling, and your bank is where you store the ${CURRENCY_NAME} that you want to keep safe.
            You can transfer ${CURRENCY_NAME} from your wallet to your bank and vice versa using \`/bank [deposit|withdraw] [amount]\`. You can also see how much ${CURRENCY_NAME} you have in your wallet and bank using \`/balance\`.
            The ${CURRENCY_NAME} in your bank will earn interest every day. The current interest rate is ${INTEREST_RATE}%.

            To see how much ${CURRENCY_NAME} you have, use \`/balance\`. To see how much ${CURRENCY_NAME} someone else has, use \`/balance @user\`.
            
            Players can send ${CURRENCY_NAME} to each other using \`/give @user [amount]\`. They will be notified when they receive ${CURRENCY_NAME}.

            You can also steal ${CURRENCY_NAME} from other users using \`/steal @user\`. There is a 25% chance of success when stealing from another user. 
            The amount stolen will be between 1 and 100% of the user's wallet. You can only attempt to steal from a user once every 5 minutes.
            You can only steal from a user's wallet and not their bank. Be sure to put all your excess ${CURRENCY_NAME} in your bank so you don't get robbed!
            `
    },
    dailyweekly: {
        name: "Dailies and Weeklies",
        description: `
            Dailies and weeklies are a way to earn ${CURRENCY_NAME} every day and week. You can claim your daily and weekly rewards using \`/daily\` and \`/weekly\`, respectively.
            You can only claim these rewards once per day and one per week. You can view your cooldowns by using \`/daily\` and \`/weekly\`.

            Dailies are worth a random amount of ${CURRENCY_NAME} between 100 and 200. You also recieve a bonus depending on how many days in a row you have claimed your daily.
            The bonus is a random amount of ${CURRENCY_NAME} between the number of days in a row and 10 times the number of days in a row.
            For example, if you have claimed your daily for 5 days in a row, you will get a bonus of between 5 and 50 ${CURRENCY_NAME}.
            The bonus resets to 0 if you miss a day.

            Weeklies are worth a random amount of ${CURRENCY_NAME} between 500 and 1000. There are no streak bonuses for weeklies.
            `,
        note: `
            Dailies and weeklies claimable every 24 hours and 7 days, respectively. They do not reset at midnight, but rather at the time you claimed them.`
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
            
            If you choose to double down, you will double your bet and be given one more card. You will then be forced to stand. 
            You can only double down on the first two cards.
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
            9. Doubling is like a hit, only the bet is doubled and you only get one more card.`
    },
    slots: {
        name: "Slots",
        description: `
            Slots is a game where you spin a slot machine and try to get three of the same symbol.
            There are 8 symbols, each with a different multiplier. You can see the paytable by using \`/slots paytable\`.
            `,
        rules: `
            1. The goal of slots is to get three of the same symbol.
            2. There are 8 symbols, each with a different multiplier.
            3. Getting a single cherry will return your bet. Two cherries will return 2x your bet. Three cherries will return 5x your bet.
            4. The jackpot is 100x your bet. The bot will also @everyone if you win the jackpot.`
    },
    poker: {
        name: "Poker",
        description: `
            Poker is a card game where the goal is to get the best hand possible. This bot uses video poker rules.
            You will be dealt 5 cards and you can choose to keep or discard any number of cards.
            You can then choose to keep or discard any number of cards again. You can keep all 5 cards if you want as well.
            After you are done discarding, you will be given your final hand and you will be paid out based on the paytable.
            You can see the paytable by using \`/poker paytable\`.
            `,
        notes: `
            1. Aces are high, and straights can wrap around. Aces can be used as a high or low card, and straights can wrap around.
            2. Jacks or Better is the minimum hand to win. Pair of Jacks or Better pays 1:1.
            3. With this game being video poker, there is no dealer. You are playing against the machine, not other players.
            4. If you take too long to make a decision, you will be timed out and lose your bet.
            5. Since the probability of getting a good hand is low, the payouts are high. Try small bets at first to get a feel for the game.
            6. The chance of getting a royal flush is 1 in 649,740. It pays 250:1. The bot will also @everyone if you win a royal flush.`
    },
    music: {
        name: "Music",
        description: `
            This bot has a music player! You can play music by using \`/play [url|search query]\`. It will join your voice channel and play the music you requested.
            If there is already music playing, it will be added to the queue. You can see the queue by using \`/queue view\`.
            
            The bot currently supports YouTube, SoundCloud, Spotify, Vimeo, Apple Music, and direct links to audio files.
            You can request direct links to songs or playlists by using \`/play [url]\`. You can also search for songs via Youtube by using \`/play [search query]\`.
            
            The queue can be shuffled by using \`/queue shuffle\`. You can also clear the queue by using \`/queue clear\`.
            
            Filters can also be applied to the music. You can see the list of filters by using \`/filter\`.
            You can toggle a filter by using \`/filter [filter name]\`. To turn off all filters, use \`/filter clear\`.`,
        example: `
            \`/play https://www.youtube.com/watch?v=dQw4w9WgXcQ\`
            \`/play never gonna give you up\`
            \`/play https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=95d37994c0a64c20\`
            \`/play https://soundcloud.com/rick-astley-official/never-gonna-give-you-up-4\`
            \`/play https://music.apple.com/us/album/never-gonna-give-you-up/1558533900?i=1558534271\``,
        note: `
            The bot will leave your voice channel after the queue is empty. You can also make it leave by pressing the stop button.
            Spotify and Apple Music links play their YouTube equivalent. The song may not sound exactly the same, but it will be the same song.
            Filters are applied to the entire queue. When the queue is cleared, the filters will also be cleared.`,
    },
}