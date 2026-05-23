const { SlashCommandBuilder } = require("discord.js");
const { addNewDBUser, db } = require("../../database");
const { CURRENCY_NAME } = require("../../config.js");
const { formatTimeLeft } = require("../../utils/time");
const logger = require("../../utils/logger");
const { buildErrorEmbed, buildSuccessEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("weekly")
    .setDescription(`Claim your weekly ${CURRENCY_NAME}.`),
  async execute(interaction) {
    const user = interaction.user;
    const dbUser = await db.get(user.id);
    logger.debug(`dbUser: ${dbUser} (type: ${typeof dbUser})`);
    if (!dbUser) {
      logger.warn(`No database entry for user ${user.username} (${user.id}), creating one...`);
      await addNewDBUser(user);
    }
    
    const cooldown = 6.048e+8; // 7 days
    
    if (dbUser.cooldowns.weekly > Date.now()) {
      return await interaction.reply({ embeds: [buildErrorEmbed(user, interaction.client, `You have already claimed your weekly ${CURRENCY_NAME}! Next claim available **${await formatTimeLeft(dbUser.cooldowns.weekly)}**.`)] });
    }

    const amount = Math.floor(Math.random() * 500) + 500;
    await db.add(`${user.id}.bank`, amount);
    await db.add(`${user.id}.stats.weeklies.claimed`, 1);
    await db.set(`${user.id}.cooldowns.weekly`, Date.now() + cooldown);

    const embed = buildSuccessEmbed(user, interaction.client, `You have claimed your weekly ${CURRENCY_NAME}! **${amount.toLocaleString("en-US")}** ${CURRENCY_NAME} has been added to your bank.`);
    await interaction.reply({ embeds: [embed] });
    logger.log(`${user.username} (${user.id}) claimed their weekly ${CURRENCY_NAME} and received ${amount.toLocaleString("en-US")} ${CURRENCY_NAME}.`);
  }
};