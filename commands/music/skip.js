const { SlashCommandBuilder } = require("discord.js");
const { resolveMusicContext } = require("../../utils/musicGuards");
const { skipTrack, isLooping } = require("../../utils/musicControls");
const { buildInfoEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current song."),

  async execute(interaction) {
    const { queue, failed } = await resolveMusicContext(interaction);
    if (failed) return;

    const skipped = queue.currentTrack.title;
    const upNext = queue.tracks.at(0);
    await skipTrack(queue);

    // Skipping keeps the loop switched on, so it carries to whatever plays next.
    const looping = isLooping(queue) ? "\n🔁 Loop stays on for the next song." : "";
    const following = upNext ? `\nNow playing **${upNext.title}**.` : "\nNothing else is queued.";
    return interaction.reply({
      embeds: [buildInfoEmbed(interaction.user, interaction.client, `⏭️ Skipped **${skipped}**.${following}${looping}`)],
    });
  },
};
