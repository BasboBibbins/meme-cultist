const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { addNewDBUser, db } = require("../../database");
const { CURRENCY_NAME, WEEKLY_COOLDOWN } = require("../../config.js");
const { formatTimeLeft } = require("../../utils/time");
const logger = require("../../utils/logger");
const { withUserLock } = require("../../utils/userlock");
const { rollWeekly } = require("../../utils/claims");
const { buildErrorEmbed, buildSuccessEmbed } = require("../../utils/embeds");

async function claimWeekly(user) {
  let dbUser = await db.get(user.id);
  if (!dbUser) {
    logger.warn(`No database entry for user ${user.username} (${user.id}), creating one...`);
    await addNewDBUser(user);
    dbUser = await db.get(user.id);
  }

  const now = Date.now();
  if (dbUser.cooldowns.weekly > now) return { claimed: false, availableAt: dbUser.cooldowns.weekly };

  const amount = rollWeekly();

  // Each quick.db write rewrites the whole user row, so parallel writes clobber each other.
  await db.add(`${user.id}.bank`, amount);
  await db.add(`${user.id}.stats.weeklies.claimed`, 1);
  await db.set(`${user.id}.cooldowns.weekly`, now + WEEKLY_COOLDOWN);

  return { claimed: true, amount };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("weekly")
    .setDescription(`Claim your weekly ${CURRENCY_NAME}.`),
  async execute(interaction) {
    const user = interaction.user;

    let result;
    try {
      result = await withUserLock(user.id, () => claimWeekly(user));
    } catch (err) {
      logger.error(`Weekly claim failed for ${user.username} (${user.id}): ${err}`);
      return interaction.reply({ embeds: [buildErrorEmbed(user, interaction.client, `Something went wrong claiming your weekly ${CURRENCY_NAME}.`)], flags: MessageFlags.Ephemeral });
    }

    if (!result.claimed) {
      return interaction.reply({ embeds: [buildErrorEmbed(user, interaction.client, `You have already claimed your weekly ${CURRENCY_NAME}! Next claim available **${await formatTimeLeft(result.availableAt)}**.`)], flags: MessageFlags.Ephemeral });
    }

    await interaction.reply({ embeds: [buildSuccessEmbed(user, interaction.client, `You have claimed your weekly ${CURRENCY_NAME}! **${result.amount.toLocaleString("en-US")}** ${CURRENCY_NAME} has been added to your bank.`)] });
    logger.log(`${user.username} (${user.id}) claimed their weekly ${CURRENCY_NAME} and received ${result.amount.toLocaleString("en-US")} ${CURRENCY_NAME}.`);
  },
};
