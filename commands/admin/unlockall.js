const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const { getAllItems, grantItem } = require("../../utils/inventory");
const { OWNER_ID, ADMIN_COMMANDS_OWNER_ONLY } = require("../../config.js");
const logger = require("../../utils/logger");
const { buildSuccessEmbed, buildErrorEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("unlockall")
    .setDescription("Unlock all purchasable items for a user (Admins only).")
    .addUserOption(opt =>
      opt.setName("target")
        .setDescription("The user to unlock all items for.")
        .setRequired(true)),

  async execute(interaction) {
    const isOwner = interaction.user.id === OWNER_ID;
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    const allowed = isOwner || (!ADMIN_COMMANDS_OWNER_ONLY && isAdmin);
    if (!allowed) {
      await interaction.reply({ content: "You do not have permission to use this command.", flags: MessageFlags.Ephemeral });
      return;
    }

    const targetUser = interaction.options.getUser("target");
    const admin = interaction.user;

    try {
      const items = getAllItems().filter(i => i.weight > 0 || i.tier === "limited");
      for (const item of items) {
        await grantItem(targetUser.id, item.id);
      }
      logger.info(`Admin ${admin.tag} (${admin.id}) used /unlockall on ${targetUser.tag} (${targetUser.id})`);
      return interaction.reply({ embeds: [buildSuccessEmbed(admin, interaction.client, `Successfully unlocked all ${items.length} items for **${targetUser.username}**!`)
        .setAuthor({ name: "Unlock All Items", iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })] });
    } catch (error) {
      logger.error(`Error executing /unlockall: ${error}`);
      return interaction.reply({ embeds: [buildErrorEmbed(admin, interaction.client, `An error occurred while unlocking items for ${targetUser.username}.`)], flags: MessageFlags.Ephemeral });
    }
  },
};
