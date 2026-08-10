const { SlashCommandBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags } = require("discord.js");
const logger = require("../../utils/logger");
const { buildInfoEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("restart")
    .setDescription("[ADMIN] Restart the bot."),
  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return await interaction.reply({content: "You do not have permission to use this command.", flags: MessageFlags.Ephemeral});
    }

    const embed = buildInfoEmbed(interaction.user, interaction.client, "Are you sure you want to restart the bot? This will cause the bot to go offline for a few seconds.", 0x00AE86)
      .setTitle(":warning: WARNING :warning:");
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId("restart")
          .setLabel("Restart")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("cancel")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Danger),
      );
    await interaction.reply({embeds: [embed], components: [row], flags: MessageFlags.Ephemeral});

    const filter = i => i.customId === "restart" || i.customId === "cancel";
    const collector = interaction.channel.createMessageComponentCollector({ filter, time: 15000 });

    collector.on("collect", async i => {
      if (i.customId === "restart") {
        embed.setDescription("Restarting...");
        await i.update({embeds: [embed], components: []});
        process.exit(0);
                
      } else if (i.customId === "cancel") {
        embed.setDescription("Restart cancelled.");
        await i.update({embeds: [embed], components: []});
      }
      collector.stop();
    });
        
    collector.on("end", async (collected, reason) => {
      logger.debug(`Restart collector has ended. Collected ${collected.size} interactions. Reason: ${reason}`);
      if (reason === "time") {
        await interaction.editReply({content: "Restart cancelled due to inactivity.", components: []});
      }
    });
  },
};
