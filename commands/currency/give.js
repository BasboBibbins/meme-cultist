const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, escapeMarkdown } = require("discord.js");
const { addNewDBUser, db } = require("../../database");
const { CURRENCY_NAME, GIVE_CONFIRM_THRESHOLD, GIVE_CONFIRM_TIMEOUT } = require("../../config.js");
const { parseBet, validateTransferAmount } = require("../../utils/betparse");
const { formatDuration } = require("../../utils/time");
const logger = require("../../utils/logger");
const { sendDM } = require("../../utils/dm");
const { buildErrorEmbed, buildSuccessEmbed, buildInfoEmbed } = require("../../utils/embeds");
const { withUserLock } = require("../../utils/userlock");

const CONFIRM_ID = "give_confirm";
const CANCEL_ID = "give_cancel";

function rejectionText(reason, balance) {
  switch (reason) {
    case "not_whole": return `You must give a whole number of ${CURRENCY_NAME}!`;
    case "below_minimum": return `You can't give less than 1 ${CURRENCY_NAME}!`;
    case "insufficient": return `You only have **${balance.toLocaleString("en-US")}** ${CURRENCY_NAME} in your wallet. Withdraw from your bank with \`/bank withdraw\` if you need more.`;
    default: return `You must give a number of ${CURRENCY_NAME}!`;
  }
}

// The button names the action and the amount, so the row still reads correctly on its own.
function buildConfirmRow(amount) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CONFIRM_ID).setLabel(`Send ${amount.toLocaleString("en-US")} ${CURRENCY_NAME}`).setStyle(ButtonStyle.Danger),
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

// maskedLink is off by default in escapeMarkdown, and it is the one that turns a nickname into a clickable link.
function safeName(user) {
  return escapeMarkdown(user.displayName || user.username || "someone", { maskedLink: true });
}

// The money has already moved by now, so a dismissed ephemeral must not throw on top of it.
async function settle(interaction, embed, press) {
  try {
    if (press && !press.replied && !press.deferred) return await press.update({ embeds: [embed], components: [] });
    return await interaction.editReply({ embeds: [embed], components: [] });
  } catch (err) {
    logger.warn(`[give] Could not update the confirmation message: ${err.message}`);
    return null;
  }
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
    const errorEmbed = buildErrorEmbed(sender, interaction.client);
    if (!(await db.get(sender.id))) {
      logger.warn(`No database entry for user ${sender.username} (${sender.id}), creating one...`, "warn");
      await addNewDBUser(sender);
    }
    if (!(await db.get(receiver.id))) {
      logger.warn(`No database entry for user ${receiver.username} (${receiver.id}), creating one...`, "warn");
      await addNewDBUser(receiver);
    }
    const senderBalance = (await db.get(`${sender.id}.balance`)) || 0;
    if (receiver.bot) {
      return await interaction.reply({ embeds: [errorEmbed.setDescription(`You can't give ${CURRENCY_NAME} to a bot!`)], flags: MessageFlags.Ephemeral });
    }
    if (sender.id === receiver.id) {
      return await interaction.reply({ embeds: [errorEmbed.setDescription(`You can't give ${CURRENCY_NAME} to yourself!`)], flags: MessageFlags.Ephemeral });
    }
    const check = validateTransferAmount(amount, senderBalance);
    if (!check.ok) {
      return await interaction.reply({ embeds: [errorEmbed.setDescription(rejectionText(check.reason, senderBalance))], flags: MessageFlags.Ephemeral });
    }

    if (amount < GIVE_CONFIRM_THRESHOLD) {
      const result = await transfer(sender, receiver, amount);
      if (!result.ok) {
        return await interaction.reply({ embeds: [errorEmbed.setDescription(`You don't have enough ${CURRENCY_NAME} to give!`)], flags: MessageFlags.Ephemeral });
      }
      await interaction.reply({ embeds: [buildReceipt(interaction, sender, receiver, amount, result.balance)], flags: MessageFlags.Ephemeral });
      return await notifyReceiver(interaction, sender, receiver, amount);
    }

    const promptEmbed = buildInfoEmbed(sender, interaction.client, `This can't be undone. You'll have **${(senderBalance - amount).toLocaleString("en-US")}** ${CURRENCY_NAME} left.\n\nExpires in **${formatDuration(GIVE_CONFIRM_TIMEOUT)}**.`)
      .setAuthor({ name: `Send ${amount.toLocaleString("en-US")} ${CURRENCY_NAME} to ${receiver.displayName}?`, iconURL: sender.displayAvatarURL({ dynamic: true }) })
      .setThumbnail(receiver.displayAvatarURL({ dynamic: true, size: 1024 }));
    await interaction.reply({ embeds: [promptEmbed], components: [buildConfirmRow(amount)], flags: MessageFlags.Ephemeral });

    let press;
    try {
      const msg = await interaction.fetchReply();
      press = await msg.awaitMessageComponent({ filter: i => i.user.id === sender.id, time: GIVE_CONFIRM_TIMEOUT });
    } catch (_) {
      return await settle(interaction, errorEmbed.setDescription("Confirmation expired. Nothing was sent."));
    }

    if (press.customId === CANCEL_ID) {
      return await settle(interaction, buildInfoEmbed(sender, interaction.client, "Cancelled. Nothing was sent."), press);
    }

    // Clearing the row now, not after the transfer, closes the window where a second press hits a spent collector.
    await press.update({ embeds: [promptEmbed.setDescription(`Sending **${amount.toLocaleString("en-US")}** ${CURRENCY_NAME} to **${safeName(receiver)}**…`)], components: [] });
    const result = await transfer(sender, receiver, amount);
    if (!result.ok) {
      return await settle(interaction, errorEmbed.setDescription(`Your balance dropped while the confirmation was open, so nothing was sent. You have **${result.balance.toLocaleString("en-US")}** ${CURRENCY_NAME}.`));
    }
    logger.log(`${sender.username} gave ${amount} ${CURRENCY_NAME} to ${receiver.username} (confirmed).`);
    await settle(interaction, buildReceipt(interaction, sender, receiver, amount, result.balance));
    await notifyReceiver(interaction, sender, receiver, amount);
  }
};
