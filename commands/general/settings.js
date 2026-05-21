const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { SETTINGS_REGISTRY, getUserSettings, toggleSetting } = require("../../utils/settings");
const { randomHexColor } = require("../../utils/randomcolor");

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
    const footer = {
      text: `${interaction.client.user.username} | Version ${require("../../package.json").version}`,
      iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }),
    };

    if (sub === "toggle") {
      const key = interaction.options.getString("key");
      const result = await toggleSetting(user.id, key);
      const embed = new EmbedBuilder()
        .setAuthor({ name: `${user.displayName} | Settings`, iconURL: user.displayAvatarURL({ dynamic: true }) })
        .setDescription(`${result.meta.emoji} **${result.meta.label}** is now **${result.newValue ? "enabled" : "disabled"}**.`)
        .setColor(randomHexColor())
        .setFooter(footer)
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === "view") {
      const settings = await getUserSettings(user.id);
      let description = "";
      for (const [, setting] of Object.entries(settings)) {
        const status = setting.value ? "🟢 On" : "🔴 Off";
        description += `${setting.emoji} **${setting.label}**\n> ${setting.description}\n> Status: ${status}\n\n`;
      }
      const embed = new EmbedBuilder()
        .setAuthor({ name: `${user.displayName} | Settings`, iconURL: user.displayAvatarURL({ dynamic: true }) })
        .setDescription(description.trim() || "No settings configured.")
        .setColor(0x5865F2)
        .setFooter(footer)
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
