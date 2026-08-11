const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { addNewDBUser, db } = require("../../database");
const { CURRENCY_NAME, GIVE_CONFIRM_THRESHOLD, GIVE_CONFIRM_TIMEOUT } = require("../../config.js");
const { parseBet } = require("../../utils/betparse");
const logger = require("../../utils/logger");
const { sendDM } = require("../../utils/dm");
const { buildErrorEmbed, buildSuccessEmbed, buildInfoEmbed } = require("../../utils/embeds");
const { withUserLock } = require("../../utils/userlock");

const CONFIRM_ID = "give_confirm";
const CANCEL_ID = "give_cancel";

function buildConfirmRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CONFIRM_ID).setLabel("Send it").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(CANCEL_ID).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
}

// Re-read inside the lock: the confirmation window is long enough to spend the same koku twice.
async function transfer(sender, receiver, amount) {
  return withUserLock(sender.id, async () => {
    const balance = await db.get(`${sender.id}.balance`);
    if ((balance || 0) < amount) return { ok: false, balance: balance || 0 };
    await db.sub(`${sender.id}.balance`, amount);
    await db.add(`${receiver.id}.balance`, amount);
    return { ok: true, balance: (balance || 0) - amount };
  });
}

function buildReceipt(interaction, sender, receiver, amount, senderBalance) {
  return buildSuccessEmbed(sender, interaction.client, `You now have **${senderBalance.toLocaleString("en-US")}** ${CURRENCY_NAME} in your wallet!`)
    .setAuthor({ name: `You sent ${amount.toLocaleString("en-US")} ${CURRENCY_NAME} to ${receiver.displayName}!`, iconURL: sender.displayAvatarURL({ dynamic: true }) })
    .setThumbnail(receiver.displayAvatarURL({ dynamic: true, size: 1024 }));
}

async function notifyReceiver(interaction, sender, receiver, amount) {
  const receiverBalance = (await db.get(`${receiver.id}.balance`)) || 0;
  const dmEmbed = buildInfoEmbed(receiver, interaction.client, `You now have **${receiverBalance.toLocaleString("en-US")}** ${CURRENCY_NAME} in your wallet!`)
    .setAuthor({ name: `You received ${amount.toLocaleString("en-US")} ${CURRENCY_NAME} from ${sender.displayName}!`, iconURL: receiver.displayAvatarURL({ dynamic: true }) })
    .setThumbnail(sender.displayAvatarURL({ dynamic: true, size: 1024 }));
  await sendDM(receiver, { embeds: [dmEmbed] });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("give")
    .setDescription(`Give ${CURRENCY_NAME} to another user.`)
    .addUserOption(option => option.setName("user").setDescription("The user to give the currency to.").setRequired(true))
    .addStringOption(option => option.setName("amount").setDescription("The amount of currency to give.").setRequired(true)),
  async execute(interaction) {
    const sender = interaction.user;
    const receiver = interaction.options.getUser("user");
    const amount = await parseBet(interaction.options.getString("amount"), sender.id);
    const dbSender = await db.get(sender.id);
    const dbReceiver = await db.get(receiver.id);
    const errorEmbed = buildErrorEmbed(sender, interaction.client);
    if (!dbSender) {
      logger.warn(`No database entry for user ${sender.username} (${sender.id}), creating one...`, "warn");
      await addNewDBUser(sender);
    }
    if (!dbReceiver) {
      logger.warn(`No database entry for user ${receiver.username} (${receiver.id}), creating one...`, "warn");
      await addNewDBUser(receiver);
    }
    if (receiver.bot) {
      return await interaction.reply({ embeds: [errorEmbed.setDescription(`You can't give ${CURRENCY_NAME} to a bot!`)], flags: MessageFlags.Ephemeral });
    }
    if (sender.id === receiver.id) {
      return await interaction.reply({ embeds: [errorEmbed.setDescription(`You can't give ${CURRENCY_NAME} to yourself!`)], flags: MessageFlags.Ephemeral });
    }
    if (amount > dbSender.balance) {
      return await interaction.reply({ embeds: [errorEmbed.setDescription(`You don't have enough ${CURRENCY_NAME} to give!`)], flags: MessageFlags.Ephemeral });
    }
    if (amount < 1) {
      return await interaction.reply({ embeds: [errorEmbed.setDescription(`You can't give less than 1 ${CURRENCY_NAME}!`)], flags: MessageFlags.Ephemeral });
    }

    if (amount < GIVE_CONFIRM_THRESHOLD) {
      const result = await transfer(sender, receiver, amount);
      if (!result.ok) {
        return await interaction.reply({ embeds: [errorEmbed.setDescription(`You don't have enough ${CURRENCY_NAME} to give!`)], flags: MessageFlags.Ephemeral });
      }
      await interaction.reply({ embeds: [buildReceipt(interaction, sender, receiver, amount, result.balance)], flags: MessageFlags.Ephemeral });
      return await notifyReceiver(interaction, sender, receiver, amount);
    }

    const promptEmbed = buildInfoEmbed(sender, interaction.client, `You are about to send **${amount.toLocaleString("en-US")}** ${CURRENCY_NAME} to **${receiver.displayName}**.\n\nThis cannot be undone. Confirm within **<t:${Math.floor((Date.now() + GIVE_CONFIRM_TIMEOUT) / 1000)}:R>**.`)
      .setAuthor({ name: "Confirm this transfer", iconURL: sender.displayAvatarURL({ dynamic: true }) })
      .setThumbnail(receiver.displayAvatarURL({ dynamic: true, size: 1024 }));
    await interaction.reply({ embeds: [promptEmbed], components: [buildConfirmRow()], flags: MessageFlags.Ephemeral });

    let press;
    try {
      const msg = await interaction.fetchReply();
      press = await msg.awaitMessageComponent({ filter: i => i.user.id === sender.id, time: GIVE_CONFIRM_TIMEOUT });
    } catch (_) {
      return await interaction.editReply({ embeds: [errorEmbed.setDescription("Transfer cancelled — you didn't confirm in time.")], components: [] });
    }

    if (press.customId === CANCEL_ID) {
      return await press.update({ embeds: [errorEmbed.setDescription("Transfer cancelled. Nothing was sent.")], components: [] });
    }

    await press.deferUpdate();
    const result = await transfer(sender, receiver, amount);
    if (!result.ok) {
      return await interaction.editReply({ embeds: [errorEmbed.setDescription(`You no longer have enough ${CURRENCY_NAME} to give — your balance changed while the confirmation was open.`)], components: [] });
    }
    logger.log(`${sender.username} gave ${amount} ${CURRENCY_NAME} to ${receiver.username} (confirmed).`);
    await interaction.editReply({ embeds: [buildReceipt(interaction, sender, receiver, amount, result.balance)], components: [] });
    await notifyReceiver(interaction, sender, receiver, amount);
  }
};
