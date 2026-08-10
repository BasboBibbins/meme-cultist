const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { db } = require("../../database");
const { CURRENCY_NAME } = require("../../config.js");
const { getAllTimeTopUsers, getCurrentTopUsers } = require("../../utils/bank");
const { getRaceStats } = require("../../utils/guildStats");
const logger = require("../../utils/logger");
const { buildInfoEmbed } = require("../../utils/embeds");

const TOTAL_PAGES = 6;

function formatHorse(horse) {
  if (!horse) return "—";
  return `${horse.emoji} ${horse.name} [${horse.displayOdds}x]`;
}

function discordDate(msTimestamp) {
  if (!msTimestamp) return "";
  return `<t:${Math.floor(msTimestamp / 1000)}:d>`;
}

function totalNumOfCmds(type) {
  if (!type || typeof type !== "object") return 0;
  return Object.keys(type).reduce((a, b) => a + (type[b] || 0), 0);
}

function topBy(users, getValue, limit = 5) {
  return users
    .map(u => ({ id: u.id, value: getValue(u) || 0 }))
    .filter(u => u.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function formatTopList(top, unit = "") {
  if (!top.length) return "*No entries yet*";
  const suffix = unit ? ` ${unit}` : "";
  return top.map((u, i) => `${i + 1}. <@${u.id}> — ${u.value.toLocaleString("en-US")}${suffix}`).join("\n");
}

async function generateLeaderboardEmbed(page, interaction, allUsers) {
  const embed = buildInfoEmbed(interaction.user, interaction.client)
    .setAuthor({ name: `Requested by ${interaction.user.displayName}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
    .setFooter({ text: `Leaderboard | Page ${page}/${TOTAL_PAGES}`, iconURL: interaction.guild.iconURL({ dynamic: true }) || interaction.client.user.displayAvatarURL({ dynamic: true }) })
    .setTitle(`Leaderboard for ${interaction.guild.name}`);

  switch (page) {
    case 1: {
      const current = await getCurrentTopUsers();
      const allTime = await getAllTimeTopUsers();
      embed.addFields(
        { name: "Current Top 10 Banks", value: current.map((user, index) => `${index + 1}. <@${user.id}> - ${user.value.bank.toLocaleString("en-US")} ${CURRENCY_NAME}`).join("\n"), inline: true },
        { name: "All Time Top 10 Banks", value: allTime.map((user, index) => `${index + 1}. <@${user.id}> - ${user.value.stats.largestBank.toLocaleString("en-US")} ${CURRENCY_NAME}`).join("\n"), inline: true }
      );
      break;
    }
    case 2: {
      embed.setDescription("Top 5 winners for each game.");
      const games = [
        ["Blackjack", "blackjack"],
        ["Slots", "slots"],
        ["Flip", "flip"],
        ["Roulette", "roulette"],
        ["Race", "race"],
        ["Craps", "craps"],
        ["Duel", "duel"],
        ["Poker", "poker"],
        ["Keno", "keno"],
        ["Beg", "begs"],
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
        ["Blackjack", "blackjack"],
        ["Slots", "slots"],
        ["Flip", "flip"],
        ["Roulette", "roulette"],
        ["Race", "race"],
        ["Craps", "craps"],
        ["Duel", "duel"],
        ["Poker", "poker"],
        ["Keno", "keno"],
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
        ["Blackjack", "blackjack"],
        ["Slots", "slots"],
        ["Flip", "flip"],
        ["Roulette", "roulette"],
        ["Race", "race"],
        ["Craps", "craps"],
        ["Duel", "duel"],
        ["Poker", "poker"],
        ["Keno", "keno"],
        ["Beg", "begs"],
      ];
      for (const [label, key] of games) {
        const top = topBy(allUsers, u => u.value.stats?.[key]?.profit);
        embed.addFields({ name: `${label} Profit`, value: formatTopList(top, CURRENCY_NAME), inline: true });
      }
      break;
    }
    case 5: {
      embed.setDescription("🏇 Server-wide horse racing records.");
      const raceStats = await getRaceStats(interaction.guild.id);
      const horseEntries = Object.values(raceStats.horses || {});

      const byWagered = horseEntries
        .filter(h => h.wagered > 0)
        .sort((a, b) => b.wagered - a.wagered)
        .slice(0, 5);
      const mostBetValue = byWagered.length
        ? byWagered.map((h, i) =>
          `${i + 1}. ${h.lastEmoji} ${h.name} [${h.lastDisplayOdds}x] — ${h.bets.toLocaleString("en-US")} bet${h.bets === 1 ? "" : "s"} / ${h.wagered.toLocaleString("en-US")} ${CURRENCY_NAME}${h.lastSeen ? ` · last seen ${discordDate(h.lastSeen)}` : ""}`
        ).join("\n")
        : "*No bets recorded yet*";
      embed.addFields({ name: "Biggest Horse Bet (most wagered)", value: mostBetValue, inline: false });

      const byBettors = horseEntries
        .map(h => ({ ...h, uniqueBettors: (h.bettorIds || []).length }))
        .filter(h => h.uniqueBettors > 0)
        .sort((a, b) => (b.uniqueBettors - a.uniqueBettors) || (b.wagered - a.wagered))
        .slice(0, 5);
      const popularValue = byBettors.length
        ? byBettors.map((h, i) =>
          `${i + 1}. ${h.lastEmoji} ${h.name} [${h.lastDisplayOdds}x] — ${h.uniqueBettors.toLocaleString("en-US")} bettor${h.uniqueBettors === 1 ? "" : "s"} / ${h.wagered.toLocaleString("en-US")} ${CURRENCY_NAME}${h.lastSeen ? ` · last seen ${discordDate(h.lastSeen)}` : ""}`
        ).join("\n")
        : "*No bets recorded yet*";
      embed.addFields({ name: "Most Popular Horse (unique bettors)", value: popularValue, inline: false });

      const byProfit = horseEntries
        .map(h => ({ ...h, profit: h.payouts - h.wagered }))
        .filter(h => h.wagered > 0)
        .sort((a, b) => b.profit - a.profit)
        .slice(0, 5);
      const profitValue = byProfit.length
        ? byProfit.map((h, i) => {
          const sign = h.profit >= 0 ? "+" : "";
          return `${i + 1}. ${h.lastEmoji} ${h.name} [${h.lastDisplayOdds}x] — ${h.wagered.toLocaleString("en-US")} wagered / ${sign}${h.profit.toLocaleString("en-US")} ${CURRENCY_NAME} profit${h.lastSeen ? ` · last seen ${discordDate(h.lastSeen)}` : ""}`;
        }).join("\n")
        : "*No bets recorded yet*";
      embed.addFields({ name: "Most Profitable Horse (bettor POV)", value: profitValue, inline: false });

      const singleBet = raceStats.biggestSingleBet;
      embed.addFields({
        name: "Biggest Single Bet",
        value: singleBet
          ? `<@${singleBet.userId}> — **${singleBet.amount.toLocaleString("en-US")}** ${CURRENCY_NAME} on ${formatHorse(singleBet.horse)} (${(singleBet.betType || "win").charAt(0).toUpperCase() + (singleBet.betType || "win").slice(1)})${singleBet.timestamp ? ` · ${discordDate(singleBet.timestamp)}` : ""}`
          : "*No bets recorded yet*",
        inline: false,
      });

      const singlePayout = raceStats.biggestSinglePayout;
      embed.addFields({
        name: "Biggest Single Payout",
        value: singlePayout
          ? `<@${singlePayout.userId}> — won **${singlePayout.amount.toLocaleString("en-US")}** ${CURRENCY_NAME} on ${formatHorse(singlePayout.horse)} (${(singlePayout.betType || "win").charAt(0).toUpperCase() + (singlePayout.betType || "win").slice(1)})${singlePayout.timestamp ? ` · ${discordDate(singlePayout.timestamp)}` : ""}`
          : "*No payouts recorded yet*",
        inline: false,
      });
      break;
    }
    case 6: {
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
    .setDescription("View the top users in the server!"),
  async execute(interaction) {
    await interaction.deferReply();

    const allUsers = (await db.all()).filter(u => u.value && u.value.name !== undefined);

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId("previous")
          .setLabel("Previous")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId("next")
          .setLabel("Next")
          .setStyle(ButtonStyle.Primary),
      );
    let page = 1;
    const msg = await interaction.editReply({ embeds: [await generateLeaderboardEmbed(page, interaction, allUsers)], components: [row] });

    const filter = i => i.customId === "previous" || i.customId === "next";
    const collector = await msg.createMessageComponentCollector({ filter, time: 60000 });

    collector.on("collect", async i => {
      await i.deferUpdate();
      if (i.customId === "previous") {
        page--;
        if (page === 1) row.components[0].setDisabled(true);
        row.components[1].setDisabled(false);
      } else if (i.customId === "next") {
        page++;
        if (page === TOTAL_PAGES) row.components[1].setDisabled(true);
        row.components[0].setDisabled(false);
      }
      collector.resetTimer();
      i.editReply({ embeds: [await generateLeaderboardEmbed(page, interaction, allUsers)], components: [row] });
    });

    collector.on("end", (collect, reason) => {
      logger.debug(`Leaderboard collector ended with reason: ${reason}`);
      interaction.editReply({ components: [] }).catch(() => {});
    });
  }
};
