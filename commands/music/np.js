const { SlashCommandBuilder } = require("discord.js");
const { resolveMusicContext } = require("../../utils/musicGuards");
const { isLooping } = require("../../utils/musicControls");
const { buildNowPlayingV2 } = require("../../utils/musicPanelV2");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("np")
    .setDescription("Show what is playing right now."),

  async execute(interaction) {
    const { queue, failed } = await resolveMusicContext(interaction);
    if (failed) return;

    // Reuses the live panel renderer minus the controls: this message has no collector, so buttons would look active and do nothing.
    return interaction.reply(buildNowPlayingV2({
      track: queue.currentTrack,
      queue,
      requestedBy: queue.metadata?.requestedBy ?? interaction.user,
      client: interaction.client,
      paused: queue.node.isPaused(),
      looping: isLooping(queue),
      controls: false,
    }));
  },
};
