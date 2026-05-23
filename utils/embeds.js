const { EmbedBuilder } = require("discord.js");
const PACKAGE_VERSION = require("../package.json").version;
const { randomHexColor } = require("./randomcolor");

const COLORS = {
  error:   0xFF0000,
  success: 0x00FF00,
  neutral: 0xAAAAAA,
  win:     0x00AE86,
  info:    0xF9844A,
  primary: 0x007BFF,
  warning: 0xFFAA00,
  blurple: 0x5865F2,
  gold:    0xFFD700,
};

function buildBaseEmbed(user, client) {
  return new EmbedBuilder()
    .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
    .setFooter({ text: `${client.user.username} | Version ${PACKAGE_VERSION}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
    .setTimestamp();
}

// description is optional — callers can omit it and chain .setDescription() themselves.
function buildErrorEmbed(user, client, description) {
  const embed = buildBaseEmbed(user, client).setColor(COLORS.error);
  if (description !== undefined) embed.setDescription(description);
  return embed;
}

function buildSuccessEmbed(user, client, description) {
  const embed = buildBaseEmbed(user, client).setColor(COLORS.success);
  if (description !== undefined) embed.setDescription(description);
  return embed;
}

// color defaults to a random palette color; pass an explicit hex string or integer to override.
function buildInfoEmbed(user, client, description, color) {
  const embed = buildBaseEmbed(user, client).setColor(color !== undefined ? color : randomHexColor());
  if (description !== undefined) embed.setDescription(description);
  return embed;
}

module.exports = { COLORS, buildBaseEmbed, buildErrorEmbed, buildSuccessEmbed, buildInfoEmbed };
