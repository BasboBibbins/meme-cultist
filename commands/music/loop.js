const { SlashCommandBuilder } = require("discord.js");
const { resolveMusicContext } = require("../../utils/musicGuards");
const { toggleLoop, setLooping, isLooping } = require("../../utils/musicControls");
const { buildInfoEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Repeat the current song until turned off.")
    .addBooleanOption(option =>
      option.setName("enabled")
        .setDescription("Turn looping on or off. Omit to toggle.")
        .setRequired(false)),

  async execute(interaction) {
    const { queue, failed } = await resolveMusicContext(interaction);
    if (failed) return;

    const requested = interaction.options.getBoolean("enabled");
    const looping = requested === null ? toggleLoop(queue) : setLooping(queue, requested);

    // TRACK repeat leaves queue.tracks untouched, so the queue resumes in order.
    const queued = queue.tracks.size;
    const note = looping
      ? `🔁 Now looping **${queue.currentTrack.title}**.${queued > 0 ? `\n${queued} track(s) still queued — use \`/skip\` to move on.` : ""}`
      : `➡️ Loop off.${queued > 0 ? " The queue continues as normal." : ""}`;

    return interaction.reply({ embeds: [buildInfoEmbed(interaction.user, interaction.client, note)] });
  },
};
