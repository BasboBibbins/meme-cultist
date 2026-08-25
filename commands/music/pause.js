const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { resolveMusicContext } = require("../../utils/music/guards");
const { setPaused } = require("../../utils/music/controls");
const { musicEmbed, musicErrorEmbed } = require("../../utils/music/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Pause the current song."),

  async execute(interaction) {
    const { queue, failed } = await resolveMusicContext(interaction);
    if (failed) return;

    if (queue.node.isPaused()) {
      return interaction.reply({
        embeds: [musicErrorEmbed(interaction, "Already paused. `/resume` picks it back up.")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await setPaused(queue, true);
    return interaction.reply({
      embeds: [await musicEmbed(interaction, `⏸️ Paused **${queue.currentTrack.title}**.`)],
    });
  },
};
