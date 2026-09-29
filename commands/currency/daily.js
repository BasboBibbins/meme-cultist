const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { addNewDBUser, db } = require("../../database");
const { CURRENCY_NAME, DAILY_COOLDOWN } = require("../../config.js");
const { formatTimeLeft } = require("../../utils/time");
const logger = require("../../utils/logger");
const { withUserLock } = require("../../utils/userlock");
const { rollDaily } = require("../../utils/claims");
const { buildErrorEmbed, buildSuccessEmbed } = require("../../utils/embeds");

function nextStreak(availableAt, currentStreak, now) {
  if (now - availableAt > DAILY_COOLDOWN) return 1;
  return currentStreak + 1;
}

async function claimDaily(user) {
  let dbUser = await db.get(user.id);
  if (!dbUser) {
    logger.warn(`No database entry for user ${user.username} (${user.id}), creating one...`);
    await addNewDBUser(user);
    dbUser = await db.get(user.id);
  }

  const now = Date.now();
  if (dbUser.cooldowns.daily > now) return { claimed: false, availableAt: dbUser.cooldowns.daily };

  const previousStreak = dbUser.stats.dailies.currentStreak || 0;
  const streak = nextStreak(dbUser.cooldowns.daily, previousStreak, now);
  const { amount, bonus } = rollDaily(streak);

  // Each quick.db write rewrites the whole user row, so parallel writes clobber each other.
  await db.set(`${user.id}.stats.dailies.currentStreak`, streak);
  await db.set(`${user.id}.stats.dailies.longestStreak`, Math.max(streak, dbUser.stats.dailies.longestStreak || 0));
  await db.add(`${user.id}.stats.dailies.claimed`, 1);
  await db.add(`${user.id}.bank`, amount + bonus);
  await db.set(`${user.id}.cooldowns.daily`, now + DAILY_COOLDOWN);

  return { claimed: true, amount, bonus, streak, lostStreak: streak < previousStreak ? previousStreak : 0 };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("daily")
    .setDescription(`Claim your daily ${CURRENCY_NAME}.`),
  async execute(interaction) {
    const user = interaction.user;

    let result;
    try {
      result = await withUserLock(user.id, () => claimDaily(user));
    } catch (err) {
      logger.error(`Daily claim failed for ${user.username} (${user.id}): ${err}`);
      return interaction.reply({ embeds: [buildErrorEmbed(user, interaction.client, `Something went wrong claiming your daily ${CURRENCY_NAME}.`)], flags: MessageFlags.Ephemeral });
    }

    if (!result.claimed) {
      return interaction.reply({ embeds: [buildErrorEmbed(user, interaction.client, `You have already claimed your daily ${CURRENCY_NAME}! Next claim available **${await formatTimeLeft(result.availableAt)}**.`)], flags: MessageFlags.Ephemeral });
    }

    const { amount, bonus, streak, lostStreak } = result;
    const total = amount + bonus;
    let description = `You claimed your daily ${CURRENCY_NAME}! **${total.toLocaleString("en-US")}** ${CURRENCY_NAME} has been added to your bank.`;
    if (bonus > 0) description += `\nYou also received a bonus for having a streak of **${streak}**!`;
    if (lostStreak > 1) description += `\nYou missed a day, so your streak of **${lostStreak}** has been reset!`;

    await interaction.reply({ embeds: [buildSuccessEmbed(user, interaction.client, description)] });
    logger.log(`${user.username} (${user.id}) claimed their daily ${CURRENCY_NAME} and received ${total} (${amount} + ${bonus}) ${CURRENCY_NAME}.`);
    logger.debug(`Current streak: ${streak}`);
  },
};
