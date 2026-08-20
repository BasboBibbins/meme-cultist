const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { resolveMusicContext } = require("../../utils/music/guards");
const { isLooping } = require("../../utils/music/controls");
const { buildNowPlayingV2, resolveMusicColors } = require("../../utils/music/panel");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("np")
    .setDescription("Show what is playing right now."),

  async execute(interaction) {
    const { queue, failed } = await resolveMusicContext(interaction);
    if (failed) return;

    const requestedBy = queue.metadata?.requestedBy ?? interaction.user;

    // Reuses the live panel renderer minus the controls: this message has no collector, so buttons would look active and do nothing.
    // live:false for the same reason. A drawn bar with no refresh behind it is wrong within seconds, so it is a timestamp instead.
    // Ephemeral because the real panel is already in the channel; a second public copy just competes with it.
    return interaction.reply({
      ...buildNowPlayingV2({
        track: queue.currentTrack,
        queue,
        requestedBy,
        client: interaction.client,
        colors: await resolveMusicColors(requestedBy?.id),
        paused: queue.node.isPaused(),
        looping: isLooping(queue),
        controls: false,
        live: false,
      }),
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
  },
};
