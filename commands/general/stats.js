const {SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { CURRENCY_NAME } = require("../../config.js");
const { addNewDBUser, db, applyCommandStatsResets } = require("../../database");
const { getUserChatbotData } = require("../../utils/openai");
const logger = require("../../utils/logger");
const { sendDM } = require("../../utils/dm");
const { randomHexColor } = require("../../utils/randomcolor");
const { todayStamp } = require("../../utils/time.js");
const { AttachmentBuilder } = require("discord.js");

function totalNumOfCmds(type) {
  return Object.keys(type).reduce((a, b) => a + type[b], 0);
}

function getFavoriteCommand(type) {
  const keys = Object.keys(type);
  if (keys.length === 0) return { command: "None", uses: 0 };
  const command = keys.reduce((a, b) => type[a] > type[b] ? a : b);
  return { command: "/"+command, uses: type[command] };
}

function buildDesc(lines) {
  return lines.filter(Boolean).join("\n");
}

// Fetch all game stats in a single batch to reduce db calls
async function getGameStats(userId) {
  const paths = [
    "blackjack.wins", "blackjack.losses", "blackjack.ties", "blackjack.blackjacks", "blackjack.biggestWin", "blackjack.biggestLoss", "blackjack.profit",
    "slots.wins", "slots.losses", "slots.jackpots", "slots.biggestWin", "slots.biggestLoss", "slots.profit",
    "flip.wins", "flip.losses", "flip.biggestWin", "flip.biggestLoss", "flip.profit",
    "begs.wins", "begs.losses", "begs.profit",
    "roulette.wins", "roulette.losses", "roulette.totalBet", "roulette.biggestWin", "roulette.biggestLoss", "roulette.profit",
    "race.wins", "race.losses", "race.totalBet", "race.biggestWin", "race.biggestLoss", "race.biggestWinHorse", "race.biggestLossHorse", "race.profit",
    "craps.rolls", "craps.wins", "craps.losses", "craps.pushes", "craps.pointsHit", "craps.sevenOuts", "craps.totalBet", "craps.biggestWin", "craps.biggestLoss", "craps.profit",
    "duel.wins", "duel.losses", "duel.draws", "duel.totalBet", "duel.biggestWin", "duel.biggestLoss", "duel.profit",
    "poker.wins", "poker.losses", "poker.royals", "poker.biggestWin", "poker.biggestLoss", "poker.profit"
  ];

  const results = await Promise.all(
    paths.map(path => db.get(`${userId}.stats.${path}`))
  );

  const stats = {};
  paths.forEach((path, i) => {
    const [game, stat] = path.split(".");
    if (!stats[game]) stats[game] = {};
    stats[game][stat] = results[i] ?? 0;
  });

  return stats;
}

function calcTotalGames(gameStats, gameName) {
  const g = gameStats[gameName] || {};
  const wins = g.wins || 0;
  const losses = g.losses || 0;
  if (gameName === "blackjack") return wins + losses + (g.ties || 0);
  if (gameName === "slots") return wins + losses + (g.jackpots || 0);
  if (gameName === "duel") return wins + losses + (g.draws || 0);
  return wins + losses;
}

function calcWinRate(gameStats, gameName) {
  const total = calcTotalGames(gameStats, gameName);
  const wins = gameStats[gameName]?.wins || 0;
  if (total === 0) return "0.00";
  return ((wins / total) * 100).toFixed(2);
}

function formatProfit(value) {
  if (value > 0) return `+${value.toLocaleString("en-US")}`;
  if (value < 0) return `${value.toLocaleString("en-US")}`;
  return "0";
}

function formatCooldown(timestamp) {
  if (!timestamp || timestamp <= Date.now()) return "**Available now!**";
  return `<t:${Math.floor(timestamp / 1000)}:R>`;
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
    embed.setAuthor({ name: `Requested by ${interaction.user.displayName }`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) });
  }
  embed.setFooter({ text: `${user.displayName }'s Stats | Page ${page}/5`, iconURL: interaction.guild.iconURL({ dynamic: true }) });
  switch (page) {
    case 1:
      embed.setTitle(`${user.displayName }'s General Stats`);
      embed.setFields(
        { name: "General", value: `**Username:** ${user.username}\n**Nickname:** ${user.displayName }`, inline: false },
        { name: "Discord Member Since", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:f>`, inline: true },
        { name: "Joined Server", value: `<t:${Math.floor(interaction.guild.members.cache.get(user.id).joinedTimestamp / 1000)}:f>`, inline: true },
        { name: "Roles", value: `${fetchedUser.roles.cache.map(role => role.toString()).join(" ")}`, inline: false },
      );
      break;
    case 2: {
      // Apply pending period resets so a user who hasn't run a command since
      // midnight / month / year rollover sees fresh buckets, not stale data.
      const commands = await applyCommandStatsResets(user.id);
      const { daily, monthly, yearly, total } = commands;
      embed.setTitle(`${user.displayName }'s Command Stats`);
      embed.setFields(
        { name: "Today", value: `*Commands Used:* **${totalNumOfCmds(daily || {}).toLocaleString("en-US")}**\n*Favorite Command:* **${getFavoriteCommand(daily || {}).command} (${getFavoriteCommand(daily || {}).uses.toLocaleString("en-US")})**`, inline: true },
        { name: "This Month", value: `*Commands Used:* **${totalNumOfCmds(monthly || {}).toLocaleString("en-US")}**\n*Favorite Command:* **${getFavoriteCommand(monthly || {}).command} (${getFavoriteCommand(monthly || {}).uses.toLocaleString("en-US")})**`, inline: true },
        { name: " ", value: " ", inline: false},
        { name: "This Year", value: `*Commands Used:* **${totalNumOfCmds(yearly || {}).toLocaleString("en-US")}**\n*Favorite Command:* **${getFavoriteCommand(yearly || {}).command} (${getFavoriteCommand(yearly || {}).uses.toLocaleString("en-US")})**`, inline: true },
        { name: "All Time", value: `*Commands Used:* **${totalNumOfCmds(total || {}).toLocaleString("en-US")}**\n*Favorite Command:* **${getFavoriteCommand(total || {}).command} (${getFavoriteCommand(total || {}).uses.toLocaleString("en-US")})**`, inline: true },
      );
      break;
    }
    case 3: {
      const dailies = stats?.stats?.dailies || {};
      const weeklies = stats?.stats?.weeklies || {};
      const shop = stats?.stats?.shop || {};
      const cooldowns = stats?.cooldowns || {};
      embed.setTitle(`${user.displayName }'s Currency Stats`);
      embed.setFields(
        { name: "Current Balance", value: `${(stats?.balance ?? 0).toLocaleString("en-US")} ${CURRENCY_NAME}`, inline: true },
        { name: "Bank Balance", value: `${(stats?.bank ?? 0).toLocaleString("en-US")} ${CURRENCY_NAME}`, inline: true },
        { name: " ", value: " ", inline: false},
        { name: "Largest Balance", value: `${(stats?.stats?.largestBalance ?? 0).toLocaleString("en-US")} ${CURRENCY_NAME}`, inline: true },
        { name: "Largest Bank Balance", value: `${(stats?.stats?.largestBank ?? 0).toLocaleString("en-US")} ${CURRENCY_NAME}`, inline: true },
        { name: " ", value: " ", inline: false},
        { name: "Dailies", value: buildDesc([
          `*Total Claimed:* **${(dailies.claimed ?? 0).toLocaleString("en-US")}**`,
          `*Current Streak:* **${(dailies.currentStreak ?? 0).toLocaleString("en-US")}**`,
          `*Longest Streak:* **${(dailies.longestStreak ?? 0).toLocaleString("en-US")}**`,
          `*Next Available:* ${formatCooldown(cooldowns.daily)}`
        ]), inline: true },
        { name: "Weeklies", value: buildDesc([
          `*Total Claimed:* **${(weeklies.claimed ?? 0).toLocaleString("en-US")}**`,
          `*Next Available:* ${formatCooldown(cooldowns.weekly)}`
        ]), inline: true },
        { name: " ", value: " ", inline: false},
        { name: "Shop", value: buildDesc([
          `*Purchases:* **${(shop.purchases ?? 0).toLocaleString("en-US")}**`,
          `*Total Spent:* **${(shop.spent ?? 0).toLocaleString("en-US")} ${CURRENCY_NAME}**`,
          `*Biggest Purchase:* **${(shop.biggestPurchase ?? 0).toLocaleString("en-US")} ${CURRENCY_NAME}**`,
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
      const cr = gameStats.craps || {};
      const du = gameStats.duel || {};
      const pk = gameStats.poker || {};

      embed.setTitle(`${user.displayName }'s Game Stats`);
      embed.setFields(
        { name: "Blackjack", value: buildDesc([
          `*Games Played:* **${calcTotalGames(gameStats, "blackjack").toLocaleString("en-US")}**`,
          `*Win Rate:* **${calcWinRate(gameStats, "blackjack")}%**`,
          bj.blackjacks && `*Blackjacks:* **${bj.blackjacks.toLocaleString("en-US")}**`,
          bj.biggestWin && `*Biggest Win:* **${bj.biggestWin.toLocaleString("en-US")}**`,
          bj.biggestLoss && `*Biggest Loss:* **${bj.biggestLoss.toLocaleString("en-US")}**`,
          `*Net Profit:* **${formatProfit(bj.profit || 0)}**`
        ]), inline: true },
        { name: "Slots", value: buildDesc([
          `*Games Played:* **${calcTotalGames(gameStats, "slots").toLocaleString("en-US")}**`,
          `*Win Rate:* **${calcWinRate(gameStats, "slots")}%**`,
          `*Next Free Spin:* ${formatCooldown(cooldowns.freespins)}`,
          sl.jackpots && `*Jackpots:* **${sl.jackpots.toLocaleString("en-US")}**`,
          sl.biggestWin && `*Biggest Win:* **${sl.biggestWin.toLocaleString("en-US")}**`,
          sl.biggestLoss && `*Biggest Loss:* **${sl.biggestLoss.toLocaleString("en-US")}**`,
          `*Net Profit:* **${formatProfit(sl.profit || 0)}**`
        ]), inline: true },
        { name: " ", value: " ", inline: false},
        { name: "Flip", value: buildDesc([
          `*Total Flips:* **${calcTotalGames(gameStats, "flip").toLocaleString("en-US")}**`,
          `*Success Rate:* **${calcWinRate(gameStats, "flip")}%**`,
          fl.biggestWin && `*Biggest Win:* **${fl.biggestWin.toLocaleString("en-US")}**`,
          fl.biggestLoss && `*Biggest Loss:* **${fl.biggestLoss.toLocaleString("en-US")}**`,
          `*Net Profit:* **${formatProfit(fl.profit || 0)}**`
        ]), inline: true },
        { name: "Beg", value: buildDesc([
          `*Total Begs:* **${calcTotalGames(gameStats, "begs").toLocaleString("en-US")}**`,
          `*Success Rate:* **${calcWinRate(gameStats, "begs")}%**`,
          `*Net Profit:* **${formatProfit(bg.profit || 0)}**`
        ]), inline: true },
        { name: " ", value: " ", inline: false},
        { name: "Roulette", value: buildDesc([
          `*Games Played:* **${calcTotalGames(gameStats, "roulette").toLocaleString("en-US")}**`,
          `*Win Rate:* **${calcWinRate(gameStats, "roulette")}%**`,
          rl.totalBet && `*Total Bet:* **${rl.totalBet.toLocaleString("en-US")}**`,
          rl.biggestWin && `*Biggest Win:* **${rl.biggestWin.toLocaleString("en-US")}**`,
          rl.biggestLoss && `*Biggest Loss:* **${rl.biggestLoss.toLocaleString("en-US")}**`,
          `*Net Profit:* **${formatProfit(rl.profit || 0)}**`
        ]), inline: true },
        { name: "Race", value: buildDesc([
          `*Races:* **${calcTotalGames(gameStats, "race").toLocaleString("en-US")}**`,
          `*Win Rate:* **${calcWinRate(gameStats, "race")}%**`,
          rc.totalBet && `*Total Bet:* **${rc.totalBet.toLocaleString("en-US")}**`,
          rc.biggestWin && (rc.biggestWinHorse
            ? `*Biggest Win:* **${rc.biggestWin.toLocaleString("en-US")}** on ${rc.biggestWinHorse.emoji} ${rc.biggestWinHorse.name} [${rc.biggestWinHorse.displayOdds}x]`
            : `*Biggest Win:* **${rc.biggestWin.toLocaleString("en-US")}**`),
          rc.biggestLoss && (rc.biggestLossHorse
            ? `*Biggest Loss:* **${rc.biggestLoss.toLocaleString("en-US")}** on ${rc.biggestLossHorse.emoji} ${rc.biggestLossHorse.name} [${rc.biggestLossHorse.displayOdds}x]`
            : `*Biggest Loss:* **${rc.biggestLoss.toLocaleString("en-US")}**`),
          `*Net Profit:* **${formatProfit(rc.profit || 0)}**`
        ]), inline: true },
        { name: "Craps", value: buildDesc([
          `*Rolls:* **${(cr.rolls || 0).toLocaleString("en-US")}**`,
          `*Win Rate:* **${calcWinRate(gameStats, "craps")}%**`,
          cr.pointsHit && `*Points Hit:* **${cr.pointsHit.toLocaleString("en-US")}**`,
          cr.sevenOuts && `*Seven Outs:* **${cr.sevenOuts.toLocaleString("en-US")}**`,
          cr.biggestWin && `*Biggest Win:* **${cr.biggestWin.toLocaleString("en-US")}**`,
          cr.biggestLoss && `*Biggest Loss:* **${cr.biggestLoss.toLocaleString("en-US")}**`,
          `*Net Profit:* **${formatProfit(cr.profit || 0)}**`
        ]), inline: true },
      );
      if (du.wins || du.losses || du.draws) {
        embed.addFields(
          { name: "Duel", value: buildDesc([
            `*Duels:* **${calcTotalGames(gameStats, "duel").toLocaleString("en-US")}**`,
            `*Win Rate:* **${calcWinRate(gameStats, "duel")}%**`,
            du.draws && `*Draws:* **${du.draws.toLocaleString("en-US")}**`,
            du.totalBet && `*Total Bet:* **${du.totalBet.toLocaleString("en-US")}**`,
            du.biggestWin && `*Biggest Win:* **${du.biggestWin.toLocaleString("en-US")}**`,
            du.biggestLoss && `*Biggest Loss:* **${du.biggestLoss.toLocaleString("en-US")}**`,
            `*Net Profit:* **${formatProfit(du.profit || 0)}**`
          ]), inline: true },
        );
      }
      if (pk.wins || pk.losses) {
        embed.addFields(
          { name: "Poker", value: buildDesc([
            `*Games Played:* **${calcTotalGames(gameStats, "poker").toLocaleString("en-US")}**`,
            `*Win Rate:* **${calcWinRate(gameStats, "poker")}%**`,
            pk.royals && `*Royal Flushes:* **${pk.royals.toLocaleString("en-US")}**`,
            pk.biggestWin && `*Biggest Win:* **${pk.biggestWin.toLocaleString("en-US")}**`,
            pk.biggestLoss && `*Biggest Loss:* **${pk.biggestLoss.toLocaleString("en-US")}**`,
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
        : "No summary generated yet. Keep chatting!";
      const userFactsText = chatbotData.facts.length > 0
        ? chatbotData.facts.map(f => `**${f.key.replace(/_/g, " ")}:** ${f.value}`).join("\n")
        : "No facts recorded yet. Keep chatting!";
      embed.setFields(
        { name: "Messages sent to chatbot", value: `${(chatbotData.messageCount ?? 0).toLocaleString("en-US")}`, inline: true },
        { name: "\u200b", value: "\u200b", inline: false },
        { name: "Personal Summary", value: latestUserSummary.slice(0, 1024), inline: false },
        { name: "Known Facts", value: userFactsText.slice(0, 1024), inline: false },
        { name: "\u200b", value: "\u200b", inline: false },
        { name: "See more info by using the command", value: "`/whatdoyouknow`", inline: true },
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
      option.setName("user")
        .setDescription("The user to check the stats of.")
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName("export")
        .setDescription("Export stats in JSON format. Useful for nerd emojis (like Basbo).")
        .setRequired(false)),
  async execute(interaction) {
    await interaction.deferReply();
    const user = interaction.options.getUser("user") || interaction.user;
    const dbUser = await db.get(user.id);
    if (!dbUser) {
      logger.warn(`No database entry for user ${user.username} (${user.id}), creating one...`);
      await addNewDBUser(user);
    }

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
    const msg = await interaction.editReply({embeds: [await generateStatsEmbed(page, interaction, user)], components: [row]});
    const filter = i => i.customId === "previous" || i.customId === "next";
    const collector = msg.createMessageComponentCollector({ filter, time: 60000 });

    if (interaction.options.getBoolean("export")) {
      const dump = {
        exportedAt: new Date().toISOString(),
        userId: interaction.user.id,
        username: interaction.user.tag,
        dbEntry: dbUser || {}
      };
      const buffer = Buffer.from(JSON.stringify(dump, null, 2), "utf-8");
      const filename = `dataexport-${interaction.user.id}-${todayStamp()}.json`;
      const attachment = new AttachmentBuilder(buffer).setName(filename);

      const dm = await sendDM(interaction.user, {
        content: "Here is your data exported in JSON format.",
        files: [attachment],
      });
      if (dm) {
        logger.log(`[ExportData] ${interaction.user.tag} data exported to JSON. DM sent successfully.`);
        await interaction.followUp({ content: "Check your DMs — I sent you a JSON file with your stats.", ephemeral: true });
      } else {
        logger.warn(`[ExportData] DM failed or disabled for ${interaction.user.tag}. Falling back to ephemeral reply.`);
        await interaction.followUp({ content: "Here is your data exported in JSON format.", files: [attachment], ephemeral: true });
      }
    }

    collector.on("collect", async i => {
      await i.deferUpdate();
      if (i.customId === "previous") {
        if (page <= 1) return;
        page--;
        if (page === 1) {
          row.components[0].setDisabled(true);
        }
        row.components[1].setDisabled(false);
        collector.resetTimer();
        i.editReply({embeds: [await generateStatsEmbed(page, interaction, user)], components: [row], fetchReply: true});
      } else if (i.customId === "next") {
        if (page >= 5) return;
        page++;
        if (page === 5) {
          row.components[1].setDisabled(true);
        }
        row.components[0].setDisabled(false);
        collector.resetTimer();
        i.editReply({embeds: [await generateStatsEmbed(page, interaction, user)], components: [row], fetchReply: true});
      }
    });

    collector.on("end", (collect, reason) => {
      logger.debug(`Collector ended with reason: ${reason}`);
      interaction.editReply({ components: [] }).catch(() => {});
    });

  },
};