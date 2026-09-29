const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { deleteDBUser, deleteDBValue, addNewDBUser, setDBValue, previewCleanup, runCleanup } = require("../../database");
const { OWNER_ID, ADMIN_COMMANDS_OWNER_ONLY, CURRENCY_NAME, CLEANUP_INACTIVE_DAYS, CLEANUP_JACKPOT_SHARE } = require("../../config.js");
const logger = require("../../utils/logger");
const wait = require("util").promisify(setTimeout);
const { buildErrorEmbed, buildInfoEmbed, buildSuccessEmbed } = require("../../utils/embeds");
const { splitPot } = require("../../utils/dbCleanup");

const CLEANUP_CONFIRM_TIMEOUT_MS = 60000;

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
        .setDescription("[ADMIN] Remove departed members and redistribute koku from long inactive members.")),
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
        await runCleanupFlow(interaction);
        break;
    }
  },
};

const LIST_LIMIT = 10;

function listEntries(entries) {
  if (entries.length === 0) return "None";
  const lines = entries.slice(0, LIST_LIMIT).map(e => `<@${e.id}> ${e.amount.toLocaleString("en-US")} ${CURRENCY_NAME}`);
  if (entries.length > LIST_LIMIT) lines.push(`...and ${entries.length - LIST_LIMIT} more`);
  return lines.join("\n");
}

function cleanupFailureText(err) {
  const retryAfter = err?.data?.retry_after;
  if (retryAfter !== undefined) {
    const at = Math.ceil(Date.now() / 1000 + retryAfter);
    return `Discord is rate limiting member lookups. Nothing was changed. Try again <t:${at}:R>.`;
  }
  return null;
}

async function runCleanupFlow(interaction) {
  let plan;
  try {
    plan = await previewCleanup(interaction.client);
  } catch (err) {
    logger.error(`Database cleanup preview failed: ${err.stack || err}`);
    const text = cleanupFailureText(err) || "Could not build the cleanup preview. Nothing was changed.";
    await interaction.editReply({ embeds: [buildErrorEmbed(interaction.user, interaction.client, text)] });
    return;
  }
  if (plan.departed.length === 0 && plan.inactive.length === 0) {
    await interaction.editReply({ embeds: [buildInfoEmbed(interaction.user, interaction.client, "Nothing to clean up.")] });
    return;
  }

  const { jackpot, perRecipient } = splitPot(plan.total, plan.recipients.length, CLEANUP_JACKPOT_SHARE);
  const preview = buildInfoEmbed(interaction.user, interaction.client, [
    `**${plan.departed.length}** departed members will be deleted, and **${plan.inactive.length}** members inactive for over ${CLEANUP_INACTIVE_DAYS} days will have their ${CURRENCY_NAME} emptied.`,
    `**${plan.total.toLocaleString("en-US")} ${CURRENCY_NAME}** collected: **${jackpot.toLocaleString("en-US")}** to the jackpot, **${perRecipient.toLocaleString("en-US")}** each to **${plan.recipients.length}** active players.`,
  ].join("\n\n"))
    .setTitle("Database Cleanup Preview")
    .addFields(
      { name: "Departed", value: listEntries(plan.departed), inline: true },
      { name: "Inactive", value: listEntries(plan.inactive), inline: true },
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("cleanup_confirm").setLabel("Confirm").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("cleanup_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  const message = await interaction.editReply({ embeds: [preview], components: [row] });

  let click;
  try {
    click = await message.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id, time: CLEANUP_CONFIRM_TIMEOUT_MS });
  } catch {
    await interaction.editReply({ embeds: [buildInfoEmbed(interaction.user, interaction.client, "Cleanup timed out. Nothing was changed.")], components: [] });
    return;
  }
  if (click.customId === "cleanup_cancel") {
    await click.update({ embeds: [buildInfoEmbed(interaction.user, interaction.client, "Cleanup cancelled. Nothing was changed.")], components: [] });
    return;
  }

  await click.update({ embeds: [buildInfoEmbed(interaction.user, interaction.client, "Cleaning up...")], components: [] });
  try {
    const result = await runCleanup(interaction.client);
    const done = buildSuccessEmbed(interaction.user, interaction.client, [
      `Deleted **${result.departed.length}** departed members and emptied **${result.inactive.length}** inactive members.`,
      `**${result.total.toLocaleString("en-US")} ${CURRENCY_NAME}** collected: **${result.jackpot.toLocaleString("en-US")}** to the jackpot, **${result.perRecipient.toLocaleString("en-US")}** each to **${result.recipients.length}** active players.`,
    ].join("\n\n"))
      .setTitle("Database Cleanup Complete")
      .addFields(
        { name: "Departed", value: listEntries(result.departed), inline: true },
        { name: "Inactive", value: listEntries(result.inactive), inline: true },
      );
    await interaction.editReply({ embeds: [done] });
  } catch (err) {
    logger.error(`Database cleanup failed: ${err.stack || err}`);
    const text = cleanupFailureText(err) || "Cleanup failed partway. Check the logs before running it again.";
    await interaction.editReply({ embeds: [buildErrorEmbed(interaction.user, interaction.client, text)] });
  }
}
