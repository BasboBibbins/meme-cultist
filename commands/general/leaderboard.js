const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { db } = require("../../database");
const { CURRENCY_NAME } = require("../../config.js");
const { getAllTimeTopUsers, getCurrentTopUsers } = require("../../utils/bank");
const logger = require("../../utils/logger");
const { randomHexColor } = require("../../utils/randomcolor");

const TOTAL_PAGES = 5;

function totalNumOfCmds(type) {
    if (!type || typeof type !== 'object') return 0;
    return Object.keys(type).reduce((a, b) => a + (type[b] || 0), 0);
}

function topBy(users, getValue, limit = 5) {
    return users
        .map(u => ({ id: u.id, value: getValue(u) || 0 }))
        .filter(u => u.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, limit);
}

function formatTopList(top, unit = '') {
    if (!top.length) return '*No entries yet*';
    const suffix = unit ? ` ${unit}` : '';
    return top.map((u, i) => `${i + 1}. <@${u.id}> — ${u.value.toLocaleString('en-US')}${suffix}`).join('\n');
}

async function generateLeaderboardEmbed(page, interaction, allUsers) {
    const embed = new EmbedBuilder()
        .setAuthor({ name: `Requested by ${interaction.user.displayName}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
        .setColor(randomHexColor())
        .setFooter({ text: `Leaderboard | Page ${page}/${TOTAL_PAGES}`, iconURL: interaction.guild.iconURL({ dynamic: true }) || interaction.client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp()
        .setTitle(`Leaderboard for ${interaction.guild.name}`);

    switch (page) {
        case 1: {
            const current = await getCurrentTopUsers();
            const allTime = await getAllTimeTopUsers();
            embed.addFields(
                { name: "Current Top 10 Banks", value: current.map((user, index) => `${index + 1}. <@${user.id}> - ${user.value.bank.toLocaleString('en-US')} ${CURRENCY_NAME}`).join("\n"), inline: true },
                { name: "All Time Top 10 Banks", value: allTime.map((user, index) => `${index + 1}. <@${user.id}> - ${user.value.stats.largestBank.toLocaleString('en-US')} ${CURRENCY_NAME}`).join("\n"), inline: true }
            );
            break;
        }
        case 2: {
            embed.setDescription("Top 5 winners for each game.");
            const games = [
                ['Blackjack', 'blackjack'],
                ['Slots', 'slots'],
                ['Flip', 'flip'],
                ['Roulette', 'roulette'],
                ['Race', 'race'],
                ['Poker', 'poker'],
                ['Beg', 'begs'],
            ];
            for (const [label, key] of games) {
                const top = topBy(allUsers, u => u.value.stats?.[key]?.wins);
                embed.addFields({ name: `${label} Wins`, value: formatTopList(top), inline: true });
            }
            break;
        }
        case 3: {
            embed.setDescription("Biggest single wins and standout achievements.");
            const games = [
                ['Blackjack', 'blackjack'],
                ['Slots', 'slots'],
                ['Flip', 'flip'],
                ['Roulette', 'roulette'],
                ['Race', 'race'],
                ['Poker', 'poker'],
            ];
            for (const [label, key] of games) {
                const top = topBy(allUsers, u => u.value.stats?.[key]?.biggestWin);
                embed.addFields({ name: `Biggest ${label} Win`, value: formatTopList(top, CURRENCY_NAME), inline: true });
            }
            embed.addFields(
                { name: "Most Blackjacks", value: formatTopList(topBy(allUsers, u => u.value.stats?.blackjack?.blackjacks)), inline: true },
                { name: "Most Jackpots", value: formatTopList(topBy(allUsers, u => u.value.stats?.slots?.jackpots)), inline: true },
                { name: "Most Royal Flushes", value: formatTopList(topBy(allUsers, u => u.value.stats?.poker?.royals)), inline: true },
                { name: "Longest Daily Streak", value: formatTopList(topBy(allUsers, u => u.value.stats?.dailies?.longestStreak)), inline: true },
                { name: "Largest Balance Ever", value: formatTopList(topBy(allUsers, u => u.value.stats?.largestBalance), CURRENCY_NAME), inline: true },
            );
            break;
        }
        case 4: {
            embed.setDescription(`Top 5 net profit per game (in ${CURRENCY_NAME}).`);
            const games = [
                ['Blackjack', 'blackjack'],
                ['Slots', 'slots'],
                ['Flip', 'flip'],
                ['Roulette', 'roulette'],
                ['Race', 'race'],
                ['Poker', 'poker'],
                ['Beg', 'begs'],
            ];
            for (const [label, key] of games) {
                const top = topBy(allUsers, u => u.value.stats?.[key]?.profit);
                embed.addFields({ name: `${label} Profit`, value: formatTopList(top, CURRENCY_NAME), inline: true });
            }
            break;
        }
        case 5: {
            embed.setDescription("Who's been using the server the most.");
            embed.addFields(
                { name: "Most Commands Used", value: formatTopList(topBy(allUsers, u => totalNumOfCmds(u.value.stats?.commands?.total))), inline: true },
                { name: "Most Dailies Claimed", value: formatTopList(topBy(allUsers, u => u.value.stats?.dailies?.claimed)), inline: true },
                { name: "Most Weeklies Claimed", value: formatTopList(topBy(allUsers, u => u.value.stats?.weeklies?.claimed)), inline: true },
                { name: "Most Shop Purchases", value: formatTopList(topBy(allUsers, u => u.value.stats?.shop?.purchases)), inline: true },
                { name: "Most Spent at Shop", value: formatTopList(topBy(allUsers, u => u.value.stats?.shop?.spent), CURRENCY_NAME), inline: true },
                { name: "Most Items Owned", value: formatTopList(topBy(allUsers, u => (u.value.inventory?.length || 0) + (u.value.profile?.theme?.owned?.length || 0))), inline: true },
                { name: "Most Chatbot Messages", value: formatTopList(topBy(allUsers, u => u.value.chatbot?.messageCount)), inline: true },
            );
            break;
        }
    }
    return embed;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("leaderboard")
        .setDescription(`View the top users in the server!`),
    async execute(interaction) {
        await interaction.deferReply();

        const allUsers = (await db.all()).filter(u => u.value && u.value.name !== undefined);

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
        const msg = await interaction.editReply({ embeds: [await generateLeaderboardEmbed(page, interaction, allUsers)], components: [row] });

        const filter = i => i.customId === 'previous' || i.customId === 'next';
        const collector = await msg.createMessageComponentCollector({ filter, time: 60000 });

        collector.on('collect', async i => {
            await i.deferUpdate();
            if (i.customId === 'previous') {
                page--;
                if (page === 1) row.components[0].setDisabled(true);
                row.components[1].setDisabled(false);
            } else if (i.customId === 'next') {
                page++;
                if (page === TOTAL_PAGES) row.components[1].setDisabled(true);
                row.components[0].setDisabled(false);
            }
            collector.resetTimer();
            i.editReply({ embeds: [await generateLeaderboardEmbed(page, interaction, allUsers)], components: [row], fetchReply: true });
        });

        collector.on('end', (collect, reason) => {
            logger.debug(`Leaderboard collector ended with reason: ${reason}`);
            interaction.deleteReply().catch(() => {});
        });
    }
};
