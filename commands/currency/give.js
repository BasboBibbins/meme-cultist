const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { addNewDBUser, db } = require("../../database");
const { CURRENCY_NAME } = require("../../config.js");
const { parseBet } = require("../../utils/betparse");
const logger = require("../../utils/logger");
const { sendDM } = require("../../utils/dm");
const { buildErrorEmbed, buildSuccessEmbed, buildInfoEmbed } = require("../../utils/embeds");

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
    await db.sub(`${sender.id}.balance`, amount);
    await db.add(`${receiver.id}.balance`, amount);
    const successEmbed = buildSuccessEmbed(sender, interaction.client, `You now have **${(dbSender.balance - amount).toLocaleString("en-US")}** ${CURRENCY_NAME} in your wallet!`)
      .setAuthor({ name: `You sent ${amount.toLocaleString("en-US")} ${CURRENCY_NAME} to ${receiver.displayName}!`, iconURL: sender.displayAvatarURL({ dynamic: true }) })
      .setThumbnail(receiver.displayAvatarURL({ dynamic: true, size: 1024 }));
    await interaction.reply({ embeds: [successEmbed], flags: MessageFlags.Ephemeral });
    const dmEmbed = buildInfoEmbed(receiver, interaction.client, `You now have **${(dbReceiver.balance + amount).toLocaleString("en-US")}** ${CURRENCY_NAME} in your wallet!`)
      .setAuthor({ name: `You received ${amount.toLocaleString("en-US")} ${CURRENCY_NAME} from ${sender.displayName}!`, iconURL: receiver.displayAvatarURL({ dynamic: true }) })
      .setThumbnail(sender.displayAvatarURL({ dynamic: true, size: 1024 }));
    await sendDM(receiver, { embeds: [dmEmbed] });
  }
};


