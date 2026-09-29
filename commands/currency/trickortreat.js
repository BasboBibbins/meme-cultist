const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { addNewDBUser, db } = require("../../database");
const { CURRENCY_NAME } = require("../../config.js");
const logger = require("../../utils/logger");
const { withUserLock } = require("../../utils/userlock");
const { buildErrorEmbed, buildSuccessEmbed, buildInfoEmbed, COLORS } = require("../../utils/embeds");
const {
  isEventActive, nextOpeningEpoch, nextUtcMidnightMs, canClaim, rollTreat, isTrick, pickTrick, theftSplit,
} = require("../../utils/trickOrTreat");
const { canApplyPrank, possess, impersonationChannel, queueImpersonation, spook, curse } = require("../../utils/trickOrTreatPranks");

function fmt(amount) {
  return amount.toLocaleString("en-US");
}

function epoch(ms) {
  return Math.floor(ms / 1000);
}

async function claimTrickOrTreat(user, canApply) {
  let dbUser = await db.get(user.id);
  if (!dbUser) {
    logger.warn(`No database entry for user ${user.username} (${user.id}), creating one...`);
    await addNewDBUser(user);
    dbUser = await db.get(user.id);
  }

  const now = Date.now();
  const nextClaimAt = dbUser.cooldowns?.trickortreat ?? 0;
  if (!canClaim(nextClaimAt, now)) return { claimed: false, nextClaimAt };

  const resetAt = nextUtcMidnightMs(new Date(now));
  // Each quick.db write rewrites the whole user row, so parallel writes clobber each other.
  await db.add(`${user.id}.stats.halloween.claimed`, 1);
  await db.set(`${user.id}.cooldowns.trickortreat`, resetAt);

  if (!isTrick()) {
    const { amount, bonus } = rollTreat((dbUser.balance || 0) + (dbUser.bank || 0));
    await db.add(`${user.id}.bank`, amount);
    await db.add(`${user.id}.stats.halloween.treats`, 1);
    await db.add(`${user.id}.stats.halloween.earned`, amount);
    return { claimed: true, trick: null, amount, bonus, resetAt };
  }

  const theft = theftSplit(dbUser.balance, dbUser.bank);
  const trick = pickTrick(id => (id === "theft" ? theft.amount > 0 : canApply(id)));
  await db.add(`${user.id}.stats.halloween.tricks`, 1);

  if (trick === "theft") {
    await db.sub(`${user.id}.balance`, theft.fromWallet);
    await db.sub(`${user.id}.bank`, theft.fromBank);
    await db.add(`${user.id}.stats.halloween.lost`, theft.amount);
  }

  return { claimed: true, trick, theft, resetAt };
}

async function playTrick(interaction, result) {
  const { member, channel, client, user } = interaction;

  switch (result.trick) {
    case "noTreat":
      return { text: "🚪 **Trick!** The door slammed in your face. No treat today." };
    case "theft": {
      const { amount, fromWallet, fromBank } = result.theft;
      const split = fromBank > 0 ? ` (${fmt(fromWallet)} from your wallet, ${fmt(fromBank)} from your bank)` : "";
      return { text: `🦇 **Trick!** A ghoul picked your pocket and made off with **${fmt(amount)}** ${CURRENCY_NAME}${split}.` };
    }
    case "possessed": {
      const until = possess(client, user.id);
      return { text: `👻 **Trick!** You've been possessed. The spirits will haunt every message you send! They will leave <t:${epoch(until)}:R>.` };
    }
    case "impersonation": {
      queueImpersonation({ guildId: interaction.guildId, channelId: channel.id, userId: user.id });
      const target = impersonationChannel(interaction.guild, channel);
      const where = target && target.id !== channel.id ? ` It's speaking in <#${target.id}>.` : "";
      return { text: `🎭 **Trick!** A spirit has borrowed your voice. Whatever it says next, you said it!${where}` };
    }
    case "spooked":
      await spook(member);
      return { text: "😱 **Trick!** Something in the voice channel scared you right out of it!" };
    case "timeout": {
      const until = await curse(member);
      return { text: `⚰️ **Trick!** You've been cursed into silence! The curse lifts <t:${epoch(until)}:R>.` };
    }
    default:
      throw new Error(`Unknown trick ${result.trick}`);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("trickortreat")
    .setDescription(`Trick or treat! Once a day in October for ${CURRENCY_NAME}, if you dare...`),
  async execute(interaction) {
    const user = interaction.user;

    if (!isEventActive()) {
      const opensAt = nextOpeningEpoch();
      const when = opensAt ? `It returns <t:${opensAt}:R>.` : "It is not coming back.";
      return interaction.reply({ embeds: [buildErrorEmbed(user, interaction.client, `🎃 Trick or Treat only runs in October. ${when}`)], flags: MessageFlags.Ephemeral });
    }

    const context = { member: interaction.member, channel: interaction.channel };
    let result;
    try {
      result = await withUserLock(user.id, () => claimTrickOrTreat(user, id => canApplyPrank(id, context)));
    } catch (err) {
      logger.error(`Trick or treat failed for ${user.username} (${user.id}): ${err}`);
      return interaction.reply({ embeds: [buildErrorEmbed(user, interaction.client, "Something went wrong at the door. Try again.")], flags: MessageFlags.Ephemeral });
    }

    if (!result.claimed) {
      return interaction.reply({ embeds: [buildErrorEmbed(user, interaction.client, `🎃 You already went trick or treating today. Come back <t:${epoch(result.nextClaimAt)}:R>!`)], flags: MessageFlags.Ephemeral });
    }

    const comeBack = isEventActive(new Date(result.resetAt))
      ? `Come back <t:${epoch(result.resetAt)}:R> if you dare.`
      : "That was the last knock of the season. See you next October!";

    if (!result.trick) {
      const extra = result.bonus > 0 ? `\nThe neighbors felt generous and slipped in **${fmt(result.bonus)}** extra.` : "";
      const description = `🍬 **Treat!** You got **${fmt(result.amount)}** ${CURRENCY_NAME}, added to your bank.${extra}\n${comeBack}`;
      await interaction.reply({ embeds: [buildSuccessEmbed(user, interaction.client, description)] });
      logger.log(`${user.username} (${user.id}) trick or treated and received a treat of ${result.amount} (${result.amount - result.bonus} + ${result.bonus} wealth bonus) ${CURRENCY_NAME}.`);
      return;
    }

    let outcome;
    try {
      outcome = await playTrick(interaction, result);
    } catch (err) {
      logger.error(`Trick ${result.trick} failed for ${user.username} (${user.id}): ${err}`);
      outcome = { text: "🕸️ **Trick!** Something tried to get you, but it fizzled out. No treat today, though." };
    }

    await interaction.reply({ embeds: [buildInfoEmbed(user, interaction.client, `${outcome.text}\n${comeBack}`, COLORS.warning)] });
    logger.log(`${user.username} (${user.id}) trick or treated and got tricked: ${result.trick}${result.trick === "theft" ? ` (${result.theft.amount} ${CURRENCY_NAME})` : ""}.`);
  },
};
