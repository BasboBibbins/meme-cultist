const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { addNewDBUser, db } = require("../../database");
const { CURRENCY_NAME } = require("../../config.js");
const logger = require("../../utils/logger");
const { randomHexColor } = require("../../utils/randomcolor");
const { buildErrorEmbed, buildInfoEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Check a users koku balance.")
    .addUserOption(option =>
      option.setName("user")
        .setDescription("The user to check the balance of.")
        .setRequired(false)),
  async execute(interaction) {
    const user = interaction.options.getUser("user") || interaction.user;
    const dbUser = await db.get(user.id);
    if (!dbUser) {
      logger.warn(`No database entry for user ${user.username} (${user.id}), creating one...`, "warn");
      await addNewDBUser(user);
    }
    if (user.bot) {
      return await interaction.reply({ embeds: [buildErrorEmbed(user, interaction.client, `**${user.displayName}** is a bot, and therefore cannot have a balance.`)], flags: MessageFlags.Ephemeral });
    }

    const fetchedUser = await user.fetch();
    const accentColor = fetchedUser.hexAccentColor ? fetchedUser.hexAccentColor : randomHexColor();
        
    const embed = buildInfoEmbed(user, interaction.client, undefined, accentColor)
      .setAuthor({ name: `${user.displayName}'s Balance`, iconURL: user.displayAvatarURL({ dynamic: true }) })
      .addFields(
        { name: "Wallet", value: `${dbUser.balance.toLocaleString("en-US")} ${CURRENCY_NAME}`, inline: true },
        { name: "Bank", value: `${dbUser.bank.toLocaleString("en-US")} ${CURRENCY_NAME}`, inline: true },
      );
    if (interaction.options.getUser("user")) {
      embed.setFooter({ text: `Requested by ${interaction.user.displayName}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) });
    }
    await interaction.reply({ embeds: [embed] });
  },
};
