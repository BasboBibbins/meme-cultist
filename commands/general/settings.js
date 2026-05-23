const { SlashCommandBuilder } = require("discord.js");
const { getUserSettings, toggleSetting } = require("../../utils/settings");
const { buildInfoEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Manage your bot settings and preferences.")
    .addSubcommand(sub =>
      sub.setName("toggle")
        .setDescription("Toggle a setting on or off.")
        .addStringOption(opt =>
          opt.setName("key")
            .setDescription("The setting to toggle.")
            .setRequired(true)
            .addChoices(
              { name: "Direct Messages", value: "dms" },
            )))
    .addSubcommand(sub =>
      sub.setName("view")
        .setDescription("View all your current settings.")),

  async execute(interaction) {
    const user = interaction.user;
    const sub = interaction.options.getSubcommand();

    if (sub === "toggle") {
      const key = interaction.options.getString("key");
      const result = await toggleSetting(user.id, key);
      const embed = buildInfoEmbed(user, interaction.client, `${result.meta.emoji} **${result.meta.label}** is now **${result.newValue ? "enabled" : "disabled"}**.`)
        .setAuthor({ name: `${user.displayName} | Settings`, iconURL: user.displayAvatarURL({ dynamic: true }) });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === "view") {
      const settings = await getUserSettings(user.id);
      let description = "";
      for (const [, setting] of Object.entries(settings)) {
        const status = setting.value ? "🟢 On" : "🔴 Off";
        description += `${setting.emoji} **${setting.label}**\n> ${setting.description}\n> Status: ${status}\n\n`;
      }
      const embed = buildInfoEmbed(user, interaction.client, description.trim() || "No settings configured.", 0x5865F2)
        .setAuthor({ name: `${user.displayName} | Settings`, iconURL: user.displayAvatarURL({ dynamic: true }) });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
