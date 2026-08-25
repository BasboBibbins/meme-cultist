// Themed embeds for the music commands. buildInfoEmbed defaults to a random colour
// per message, which left nine commands strobing while the now-playing panel wore
// the requester's theme; everything here resolves through the same pipeline as the
// panel so one subsystem reads as one subsystem.

const { buildBaseEmbed, COLORS } = require("../embeds");
const { toEmbedColor } = require("../../themes/resolver");
const { resolveMusicColors } = require("./panel");

async function musicEmbed(interaction, description) {
  const colors = await resolveMusicColors(interaction.user?.id);
  const embed = buildBaseEmbed(interaction.user, interaction.client)
    .setColor(toEmbedColor(colors.embedColor));
  if (description !== undefined) embed.setDescription(description);
  return embed;
}

// Failures keep the shared error red rather than the theme accent: a themed red is
// not reliably red, and this is the one colour that has to mean the same thing everywhere.
function musicErrorEmbed(interaction, description) {
  const embed = buildBaseEmbed(interaction.user, interaction.client).setColor(COLORS.error);
  if (description !== undefined) embed.setDescription(description);
  return embed;
}

module.exports = { musicEmbed, musicErrorEmbed };
