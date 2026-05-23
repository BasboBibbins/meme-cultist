const { SlashCommandBuilder } = require("discord.js");
const { addNewDBUser, db } = require("../../database");
const { CURRENCY_NAME } = require("../../config.js");
const { parseBet } = require("../../utils/betparse");
const logger = require("../../utils/logger");
const { recordGameResult } = require("../../utils/gameResults");
const { buildErrorEmbed, buildBaseEmbed, COLORS } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("flip")
    .setDescription(`Flip a coin and win or lose ${CURRENCY_NAME}.`)
    .addStringOption(option =>
      option.setName("bet")
        .setDescription(`The amount of ${CURRENCY_NAME} to bet.`)
        .setRequired(true)),
  async execute(interaction) {
    const option = interaction.options.getString("bet");
    const bet = await parseBet(option, interaction.user.id);
    const dbUser = await db.get(interaction.user.id);
    if (!dbUser) {
      logger.warn(`No database entry for user ${interaction.user.username} (${interaction.user.id}), creating one...`);
      await addNewDBUser(interaction.user.id);
    }

    const errorEmbed = buildErrorEmbed(interaction.user, interaction.client);

    if (isNaN(bet)) {
      return await interaction.reply({ embeds: [errorEmbed.setDescription(`You must flip a number of ${CURRENCY_NAME}!`)], ephemeral: true });
    }
    if (bet % 1 !== 0) {
      return await interaction.reply({ embeds: [errorEmbed.setDescription(`You must flip a whole number of ${CURRENCY_NAME}!`)], ephemeral: true });
    }
    if (bet < 1) {
      return await interaction.reply({ embeds: [errorEmbed.setDescription(`You must flip at least 1 ${CURRENCY_NAME}!`)], ephemeral: true });
    }
    if (bet > await db.get(`${interaction.user.id}.balance`)) {
      return await interaction.reply({ embeds: [errorEmbed.setDescription(`You don't have enough ${CURRENCY_NAME}!`)], ephemeral: true });
    }

    const chance = Math.floor(Math.random() * 100) + 1;

    const embed = buildBaseEmbed(interaction.user, interaction.client);

    if (chance > 50) {
      embed.setColor(COLORS.success);
      embed.setTitle("Congratulations!");
      embed.setDescription(`You won **${bet.toLocaleString("en-US")}** ${CURRENCY_NAME}!\n\nYour new balance is **${(dbUser.balance + bet).toLocaleString("en-US")}** ${CURRENCY_NAME}.`);
      await db.add(`${interaction.user.id}.balance`, bet);
      await db.add(`${interaction.user.id}.stats.flip.wins`, 1);
      await db.add(`${interaction.user.id}.stats.flip.profit`, bet);
      if (bet > await db.get(`${interaction.user.id}.stats.flip.biggestWin`)) {
        await db.set(`${interaction.user.id}.stats.flip.biggestWin`, bet);
      }
      try { recordGameResult({ guildId: interaction.guildId, channelId: interaction.channelId, userId: interaction.user.id, game: "flip", result: { bet, roll: chance, outcome: "win", payout: bet, net: bet } }); } catch (_) {}
      await interaction.reply({embeds: [embed]});
    } else {
      embed.setColor(COLORS.error);
      embed.setTitle("You lose!");
      embed.setDescription(`I'll be taking **${bet.toLocaleString("en-US")}** ${CURRENCY_NAME} from you.\n\nYour new balance is **${(dbUser.balance - bet).toLocaleString("en-US")}** ${CURRENCY_NAME}. ${(dbUser.balance - bet) <= 0 ? "You're now broke!" : ""}`);
      await db.sub(`${interaction.user.id}.balance`, bet);
      await db.add(`${interaction.user.id}.stats.flip.losses`, 1);
      await db.sub(`${interaction.user.id}.stats.flip.profit`, bet);
      if (bet > await db.get(`${interaction.user.id}.stats.flip.biggestLoss`)) {
        await db.set(`${interaction.user.id}.stats.flip.biggestLoss`, bet);
      }
      try { recordGameResult({ guildId: interaction.guildId, channelId: interaction.channelId, userId: interaction.user.id, game: "flip", result: { bet, roll: chance, outcome: "loss", payout: 0, net: -bet } }); } catch (_) {}
      await interaction.reply({embeds: [embed]});
    }
  }, 
};