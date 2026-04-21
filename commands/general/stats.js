const {SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const { CURRENCY_NAME } = require("../../config.js");
const { addNewDBUser } = require("../../database");
const { getUserChatbotData } = require('../../utils/openai');
const logger = require("../../utils/logger");
const { randomHexColor } = require("../../utils/randomcolor");

function totalNumOfCmds(type) {
    return Object.keys(type).reduce((a, b) => a + type[b], 0);
}

function getFavoriteCommand(type) {
    let command = Object.keys(type).reduce((a, b) => type[a] > type[b] ? a : b);
    return { command: command, uses: type[command] };
}

function buildDesc(lines) {
    return lines.filter(Boolean).join('\n');
}

// Fetch all game stats in a single batch to reduce db calls
async function getGameStats(userId) {
    const paths = [
        'blackjack.wins', 'blackjack.losses', 'blackjack.ties', 'blackjack.blackjacks', 'blackjack.biggestWin', 'blackjack.biggestLoss', 'blackjack.profit',
        'slots.wins', 'slots.losses', 'slots.jackpots', 'slots.biggestWin', 'slots.biggestLoss', 'slots.profit',
        'flip.wins', 'flip.losses', 'flip.biggestWin', 'flip.biggestLoss', 'flip.profit',
        'begs.wins', 'begs.losses', 'begs.profit',
        'roulette.wins', 'roulette.losses', 'roulette.totalBet', 'roulette.biggestWin', 'roulette.biggestLoss', 'roulette.profit',
        'race.wins', 'race.losses', 'race.totalBet', 'race.biggestWin', 'race.biggestLoss', 'race.profit',
        'poker.wins', 'poker.losses', 'poker.royals', 'poker.biggestWin', 'poker.biggestLoss', 'poker.profit'
    ];

    const results = await Promise.all(
        paths.map(path => db.get(`${userId}.stats.${path}`))
    );

    const stats = {};
    paths.forEach((path, i) => {
        const [game, stat] = path.split('.');
        if (!stats[game]) stats[game] = {};
        stats[game][stat] = results[i] ?? 0;
    });

    return stats;
}

function calcTotalGames(gameStats, gameName) {
    const g = gameStats[gameName] || {};
    const wins = g.wins || 0;
    const losses = g.losses || 0;
    if (gameName === 'blackjack') return wins + losses + (g.ties || 0);
    if (gameName === 'slots') return wins + losses + (g.jackpots || 0);
    return wins + losses;
}

function calcWinRate(gameStats, gameName) {
    const total = calcTotalGames(gameStats, gameName);
    const wins = gameStats[gameName]?.wins || 0;
    if (total === 0) return '0.00';
    return ((wins / total) * 100).toFixed(2);
}

function formatProfit(value) {
    if (value > 0) return `+${value.toLocaleString()}`;
    if (value < 0) return `${value.toLocaleString()}`;
    return '0';
}

function formatCooldown(timestamp) {
    if (!timestamp || timestamp <= Date.now()) return '**Available now!**';
    const diff = timestamp - Date.now();
    const seconds = Math.round(diff / 1000);
    const minutes = Math.round(diff / 60000);
    const hours = Math.round(diff / 3600000);
    const days = Math.round(diff / 86400000);
    let relative;
    if (days > 1) relative = `${days} day${days !== 1 ? 's' : ''}`;
    else if (hours > 1) relative = `${hours} hour${hours !== 1 ? 's' : ''}`;
    else if (minutes > 1) relative = `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    else relative = `${seconds} second${seconds !== 1 ? 's' : ''}`;
    return `${new Date(timestamp).toLocaleString()} (~${relative})`;
}

async function generateStatsEmbed(page, interaction, user) {
    const fetchedUser = await interaction.guild.members.fetch(user.id);
    const accentColor = fetchedUser.displayHexColor || randomHexColor();

    const stats = await db.get(user.id);
    const embed = new EmbedBuilder()
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 512 }))
        .setColor(`${accentColor}`)
        .setTimestamp();

    if (user !== interaction.user) {
        embed.setAuthor({ name: `Requested by ${interaction.user.displayName }`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
    }
    embed.setFooter({ text: `${user.displayName }'s Stats | Page ${page}/5`, iconURL: interaction.guild.iconURL({ dynamic: true }) });
    switch (page) {
        case 1:
            embed.setTitle(`${user.displayName }'s General Stats`)
            embed.setFields(
                { name: "General", value: `**Username:** ${user.username}\n**Nickname:** ${user.displayName }`, inline: false },
                { name: "Discord Member Since", value: `${new Date(user.createdTimestamp).toLocaleString()}`, inline: true },
                { name: "Joined Server", value: `${new Date(interaction.guild.members.cache.get(user.id).joinedTimestamp).toLocaleString()}`, inline: true },
                { name: "Roles", value: `${fetchedUser.roles.cache.map(role => role.toString()).join(' ')}`, inline: false },
            );
            break;
        case 2: {
            const [daily, monthly, yearly, total] = await Promise.all([
                db.get(`${user.id}.stats.commands.daily`),
                db.get(`${user.id}.stats.commands.monthly`),
                db.get(`${user.id}.stats.commands.yearly`),
                db.get(`${user.id}.stats.commands.total`)
            ]);
            embed.setTitle(`${user.displayName }'s Command Stats`)
            embed.setFields(
                { name: "Today", value: `*Commands Used:* **${totalNumOfCmds(daily || {})}**\n*Favorite Command:* /**${getFavoriteCommand(daily || {}).command} (${getFavoriteCommand(daily || {}).uses})**`, inline: true },
                { name: "This Month", value: `*Commands Used:* **${totalNumOfCmds(monthly || {})}**\n*Favorite Command:* /**${getFavoriteCommand(monthly || {}).command} (${getFavoriteCommand(monthly || {}).uses})**`, inline: true },
                { name: " ", value: " ", inline: false},
                { name: "This Year", value: `*Commands Used:* **${totalNumOfCmds(yearly || {})}**\n*Favorite Command:* /**${getFavoriteCommand(yearly || {}).command} (${getFavoriteCommand(yearly || {}).uses})**`, inline: true },
                { name: "All Time", value: `*Commands Used:* **${totalNumOfCmds(total || {})}**\n*Favorite Command:* /**${getFavoriteCommand(total || {}).command} (${getFavoriteCommand(total || {}).uses})**`, inline: true },
            );
            break;
        }
        case 3: {
            const dailies = stats?.stats?.dailies || {};
            const weeklies = stats?.stats?.weeklies || {};
            const shop = stats?.stats?.shop || {};
            const cooldowns = stats?.cooldowns || {};
            embed.setTitle(`${user.displayName }'s Currency Stats`)
            embed.setFields(
                { name: "Current Balance", value: `${stats?.balance ?? 0} ${CURRENCY_NAME}`, inline: true },
                { name: "Bank Balance", value: `${stats?.bank ?? 0} ${CURRENCY_NAME}`, inline: true },
                { name: " ", value: " ", inline: false},
                { name: "Largest Balance", value: `${stats?.stats?.largestBalance ?? 0} ${CURRENCY_NAME}`, inline: true },
                { name: "Largest Bank Balance", value: `${stats?.stats?.largestBank ?? 0} ${CURRENCY_NAME}`, inline: true },
                { name: " ", value: " ", inline: false},
                { name: "Dailies", value: buildDesc([
                    `*Total Claimed:* **${dailies.claimed ?? 0}**`,
                    `*Current Streak:* **${dailies.currentStreak ?? 0}**`,
                    `*Longest Streak:* **${dailies.longestStreak ?? 0}**`,
                    `*Next Available:* ${formatCooldown(cooldowns.daily)}`
                ]), inline: true },
                { name: "Weeklies", value: buildDesc([
                    `*Total Claimed:* **${weeklies.claimed ?? 0}**`,
                    `*Next Available:* ${formatCooldown(cooldowns.weekly)}`
                ]), inline: true },
                { name: " ", value: " ", inline: false},
                { name: "Shop", value: buildDesc([
                    `*Purchases:* **${shop.purchases ?? 0}**`,
                    `*Total Spent:* **${(shop.spent ?? 0).toLocaleString()} ${CURRENCY_NAME}**`,
                    `*Biggest Purchase:* **${(shop.biggestPurchase ?? 0).toLocaleString()} ${CURRENCY_NAME}**`,
                ]), inline: true },
            );
            break;
        }
        case 4: {
            const gameStats = await getGameStats(user.id);
            const cooldowns = stats?.cooldowns || {};
            const bj = gameStats.blackjack || {};
            const sl = gameStats.slots || {};
            const fl = gameStats.flip || {};
            const bg = gameStats.begs || {};
            const rl = gameStats.roulette || {};
            const rc = gameStats.race || {};
            const pk = gameStats.poker || {};

            embed.setTitle(`${user.displayName }'s Game Stats`)
            embed.setFields(
                { name: "Blackjack", value: buildDesc([
                    `*Games Played:* **${calcTotalGames(gameStats, 'blackjack')}**`,
                    `*Win Rate:* **${calcWinRate(gameStats, 'blackjack')}%**`,
                    bj.blackjacks && `*Blackjacks:* **${bj.blackjacks}**`,
                    bj.biggestWin && `*Biggest Win:* **${bj.biggestWin}**`,
                    bj.biggestLoss && `*Biggest Loss:* **${bj.biggestLoss}**`,
                    `*Net Profit:* **${formatProfit(bj.profit || 0)}**`
                ]), inline: true },
                { name: "Slots", value: buildDesc([
                    `*Games Played:* **${calcTotalGames(gameStats, 'slots')}**`,
                    `*Win Rate:* **${calcWinRate(gameStats, 'slots')}%**`,
                    `*Next Free Spin:* ${formatCooldown(cooldowns.freespins)}`,
                    sl.jackpots && `*Jackpots:* **${sl.jackpots}**`,
                    sl.biggestWin && `*Biggest Win:* **${sl.biggestWin}**`,
                    sl.biggestLoss && `*Biggest Loss:* **${sl.biggestLoss}**`,
                    `*Net Profit:* **${formatProfit(sl.profit || 0)}**`
                ]), inline: true },
                { name: " ", value: " ", inline: false},
                { name: "Flip", value: buildDesc([
                    `*Total Flips:* **${calcTotalGames(gameStats, 'flip')}**`,
                    `*Success Rate:* **${calcWinRate(gameStats, 'flip')}%**`,
                    fl.biggestWin && `*Biggest Win:* **${fl.biggestWin}**`,
                    fl.biggestLoss && `*Biggest Loss:* **${fl.biggestLoss}**`,
                    `*Net Profit:* **${formatProfit(fl.profit || 0)}**`
                ]), inline: true },
                { name: "Beg", value: buildDesc([
                    `*Total Begs:* **${calcTotalGames(gameStats, 'begs')}**`,
                    `*Success Rate:* **${calcWinRate(gameStats, 'begs')}%**`,
                    `*Net Profit:* **${formatProfit(bg.profit || 0)}**`
                ]), inline: true },
                { name: " ", value: " ", inline: false},
                { name: "Roulette", value: buildDesc([
                    `*Games Played:* **${calcTotalGames(gameStats, 'roulette')}**`,
                    `*Win Rate:* **${calcWinRate(gameStats, 'roulette')}%**`,
                    rl.totalBet && `*Total Bet:* **${rl.totalBet}**`,
                    rl.biggestWin && `*Biggest Win:* **${rl.biggestWin}**`,
                    rl.biggestLoss && `*Biggest Loss:* **${rl.biggestLoss}**`,
                    `*Net Profit:* **${formatProfit(rl.profit || 0)}**`
                ]), inline: true },
                { name: "Race", value: buildDesc([
                    `*Races:* **${calcTotalGames(gameStats, 'race')}**`,
                    `*Win Rate:* **${calcWinRate(gameStats, 'race')}%**`,
                    rc.totalBet && `*Total Bet:* **${rc.totalBet}**`,
                    rc.biggestWin && `*Biggest Win:* **${rc.biggestWin}**`,
                    rc.biggestLoss && `*Biggest Loss:* **${rc.biggestLoss}**`,
                    `*Net Profit:* **${formatProfit(rc.profit || 0)}**`
                ]), inline: true },
            );
            if (pk.wins || pk.losses) {
                embed.addFields(
                    { name: "Poker", value: buildDesc([
                        `*Games Played:* **${calcTotalGames(gameStats, 'poker')}**`,
                        `*Win Rate:* **${calcWinRate(gameStats, 'poker')}%**`,
                        pk.royals && `*Royal Flushes:* **${pk.royals}**`,
                        pk.biggestWin && `*Biggest Win:* **${pk.biggestWin}**`,
                        pk.biggestLoss && `*Biggest Loss:* **${pk.biggestLoss}**`,
                        `*Net Profit:* **${formatProfit(pk.profit || 0)}**`
                    ]), inline: true },
                );
            }
            break;
        }
        case 5: {
            embed.setTitle(`${user.displayName}'s Chatbot Stats`);
            const chatbotData = await getUserChatbotData(user.id);
            const latestUserSummary = chatbotData.summaries.length > 0
                ? chatbotData.summaries[chatbotData.summaries.length - 1].context
                : 'No summary generated yet. Keep chatting!';
            const userFactsText = chatbotData.facts.length > 0
                ? chatbotData.facts.map(f => `**${f.key.replace(/_/g, ' ')}:** ${f.value}`).join('\n')
                : 'No facts recorded yet. Keep chatting!';
            embed.setFields(
                { name: "Messages sent to chatbot", value: `${chatbotData.messageCount}`, inline: true },
                { name: "\u200b", value: "\u200b", inline: false },
                { name: "Personal Summary", value: latestUserSummary.slice(0, 1024), inline: false },
                { name: "Known Facts", value: userFactsText.slice(0, 1024), inline: false },
            );
            break;
        }
    }
    return embed;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("stats")
        .setDescription("Check a users stats on the server.")
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to check the stats of.')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('details')
                .setDescription('Detailed stats for nerd emojis.')
                .setRequired(false)),
    async execute(interaction) {
        await interaction.deferReply();
        const user = interaction.options.getUser('user') || interaction.user;
        const dbUser = await db.get(user.id);
        if (!dbUser) {
            logger.warn(`No database entry for user ${user.username} (${user.id}), creating one...`)
            await addNewDBUser(user);
        }

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('previous')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId('next')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Primary),
            );
        let page = 1;
        msg = await interaction.editReply({embeds: [await generateStatsEmbed(page, interaction, user)], components: [row]});
        const filter = i => i.customId === 'previous' || i.customId === 'next';
        const collector = await msg.createMessageComponentCollector({ filter, time: 60000 });

        if (interaction.options.getBoolean('details')) {
            const chunks = [];
            const data = JSON.stringify(dbUser, null, 4);
            for (let i = 0; i < data.length; i += 1900) {
                chunks.push(data.substring(i, i + 1900));
            }
            for (let i = 0; i < chunks.length; i++) {
                await interaction.user.send(`\`\`\`json\n${chunks[i]}\`\`\``);
            }
        }

        collector.on('collect', async i => {
            await i.deferUpdate();
            if (i.customId === 'previous') {
                page--;
                if (page === 1) {
                    row.components[0].setDisabled(true);
                }
                row.components[1].setDisabled(false);
                collector.resetTimer();
                i.editReply({embeds: [await generateStatsEmbed(page, interaction, user)], components: [row], fetchReply: true});
            } else if (i.customId === 'next') {
                page++;
                if (page === 5) {
                    row.components[1].setDisabled(true);
                }
                row.components[0].setDisabled(false);
                collector.resetTimer();
                i.editReply({embeds: [await generateStatsEmbed(page, interaction, user)], components: [row], fetchReply: true});
            }
        });

        collector.on('end', (collect, reason) => {
            logger.debug(`Collector ended with reason: ${reason}`);
            interaction.deleteReply();
        });

    },
};