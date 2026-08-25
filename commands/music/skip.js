const { SlashCommandBuilder } = require("discord.js");
const { resolveMusicContext } = require("../../utils/music/guards");
const { skipTrack, isLooping } = require("../../utils/music/controls");
const { musicEmbed, musicErrorEmbed } = require("../../utils/music/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current song."),

  async execute(interaction) {
    const { queue, failed } = await resolveMusicContext(interaction);
    if (failed) return;

    const skipped = queue.currentTrack.title;
    const upNext = queue.tracks.at(0);

    // skip() refuses when the dispatcher has already lost the track, and reporting success there is how a wedged queue looked like a working one.
    if (!await skipTrack(queue)) {
      return interaction.reply({
        embeds: [musicErrorEmbed(interaction, `Could not skip **${skipped}**. Playback had already stopped. Use \`/stop\` and start again.`)],
      });
    }

    // Skipping keeps the loop switched on, so it carries to whatever plays next.
    const looping = isLooping(queue) ? "\n🔁 Loop stays on for the next song." : "";
    const following = upNext ? `\nNow playing **${upNext.title}**.` : "\nNothing else is queued.";
    return interaction.reply({
      embeds: [await musicEmbed(interaction, `⏭️ Skipped **${skipped}**.${following}${looping}`)],
    });
  },
};
