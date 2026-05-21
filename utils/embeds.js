const { EmbedBuilder } = require("discord.js");
const PACKAGE_VERSION = require("../package.json").version;

// Shared error embed factory. description is optional — callers that build the
// embed once and set different descriptions per branch can omit it and call
// .setDescription() themselves.
function buildErrorEmbed(user, client, description) {
  const embed = new EmbedBuilder()
    .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
    .setColor(0xFF0000)
    .setFooter({ text: `${client.user.username} | Version ${PACKAGE_VERSION}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
    .setTimestamp();
  if (description !== undefined) embed.setDescription(description);
  return embed;
}

module.exports = { buildErrorEmbed };
