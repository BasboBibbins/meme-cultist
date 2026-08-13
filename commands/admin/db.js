const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const { deleteDBUser, deleteDBValue, addNewDBUser, setDBValue, cleanDB, db } = require("../../database");
const { OWNER_ID, ADMIN_COMMANDS_OWNER_ONLY } = require("../../config.js");
const logger = require("../../utils/logger");
const wait = require("util").promisify(setTimeout);
const { buildErrorEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("db")
    .setDescription("[ADMIN] Manage database entries.")
    .addSubcommand(subcommand =>
      subcommand
        .setName("add")
        .setDescription("[ADMIN] Add a new database entry.")
        .addUserOption(option =>
          option.setName("user")
            .setDescription("The user to add to the database.")
            .setRequired(true))
        .addStringOption(option =>
          option.setName("key")
            .setDescription("The key to set. (Optional)")
            .setRequired(false))
        .addStringOption(option =>
          option.setName("value")
            .setDescription("The value to set. (Optional)")
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName("delete")
        .setDescription("[ADMIN] Delete a database entry.")
        .addUserOption(option =>
          option.setName("user")
            .setDescription("The user to delete from the database.")
            .setRequired(true))
        .addStringOption(option =>
          option.setName("key")
            .setDescription("The key to delete.")
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName("set")
        .setDescription("[ADMIN] Set a database entry.")
        .addUserOption(option =>
          option.setName("user")
            .setDescription("The user to set the database entry for.")
            .setRequired(true))
        .addStringOption(option =>
          option.setName("key")
            .setDescription("The key to set.")
            .setRequired(true))
        .addStringOption(option =>
          option.setName("value")
            .setDescription("The value to set.")
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName("reset")
        .setDescription("[ADMIN] Reset a database entry.")
        .addUserOption(option =>
          option.setName("user")
            .setDescription("The user to reset all data from the database.")
            .setRequired(true)))
    .addSubcommand (subcommand =>
      subcommand
        .setName("cleanup")
        .setDescription("[ADMIN] Cleanup the database.")),
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const user = interaction.options.getUser("user") || interaction.user;
    const key = interaction.options.getString("key");
    const value = interaction.options.getString("value");

    const errorEmbed = buildErrorEmbed(user, interaction.client);

    const isOwner = interaction.user.id === OWNER_ID;
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    const allowed = isOwner || (!ADMIN_COMMANDS_OWNER_ONLY && isAdmin);
    if (!allowed) {
      return await interaction.reply({ embeds: [errorEmbed.setDescription("You do not have permission to use this command.")], flags: MessageFlags.Ephemeral });
    }
    if (user.bot) {
      return await interaction.reply({ embeds: [errorEmbed.setDescription("You cannot use this command on a bot.")], flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({flags: MessageFlags.Ephemeral});
    await wait (1000);
    switch (subcommand) {
      case "add":
        if (key && value) {
          await setDBValue(user, key, value);
          await interaction.editReply({content: `Added database entry for user ${user.username} (${user.id}) for key \`${key}\` with value \`${value}\`.`});
          logger.log(`Added database entry for user ${user.username} (${user.id}) for key \`${key}\` with value \`${value}\`.`, "info");
        } else {
          await addNewDBUser(user);
          await interaction.editReply({content: `Added database entry for user ${user.username} (${user.id}).`});
          logger.log(`Added database entry for user ${user.username} (${user.id}).`, "info");
        }
        break;
      case "delete":
        if (key) {
          await deleteDBValue(user, key);
          await interaction.editReply({content: `Deleted database entry for user ${user.username} (${user.id}) for key \`${key}\`.`});
          logger.log(`Deleted database entry for user ${user.username} (${user.id}) for key \`${key}\`.`, "info");
        } else {
          await deleteDBUser(user);
          await interaction.editReply({content: `Deleted database entry for user ${user.username} (${user.id}).`});
          logger.log(`Deleted database entry for user ${user.username} (${user.id}).`, "info");
        }
        break;
      case "set":
        await setDBValue(user, key, value);
        await interaction.editReply({content: `Set database entry for user ${user.username} (${user.id}) for key \`${key}\` to \`${value}\`.`});
        logger.log(`Set database entry for user ${user.username} (${user.id}) for key \`${key}\` to \`${value}\`.`, "info");
        break;
      case "reset":
        await deleteDBUser(user);
        await addNewDBUser(user);
        await interaction.editReply({content: `Reset database entry for user ${user.username} (${user.id}) to the default.`});
        logger.log(`Reset database entry for user ${user.username} (${user.id}) to the default.`, "info");
        break;
      case "cleanup":
        const deleted = await cleanDB(interaction.client) || []; // returns array or empty array
        if (deleted.length === 0) {
          await interaction.editReply({content: "No entries to delete!"});
          return;
        }
        await interaction.editReply({content: `Cleaned up the database. Deleted ${deleted.length} entries.\nDeleted users: ${deleted.map(user => `<@${user.id}>`).join("\n")}`});
        logger.log("Cleaned up the database.", "info");
        break;
    }
  },
};
