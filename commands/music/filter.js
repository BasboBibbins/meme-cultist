const { SlashCommandBuilder } = require("discord.js");
const logger = require("../../utils/logger");
const { musicEmbed, musicErrorEmbed } = require("../../utils/music/embeds");
const { resolveMusicContext } = require("../../utils/music/guards");

// Names alone are opaque, so the description rides along in the autocomplete label.
const FILTERS = {
  "8d": "Spins the audio around your head",
  bassboost: "Heavier low end",
  chorus: "Doubled, slightly detuned",
  compressor: "Squashes the loud parts",
  dim: "Duller, further away",
  earrape: "Exactly what it says. You've been warned",
  expander: "Widens the dynamic range",
  fadein: "Eases the volume up at the start",
  flanger: "Sweeping jet-engine whoosh",
  gate: "Cuts everything below a threshold",
  haas: "Fake stereo width",
  karaoke: "Tries to pull the vocals out",
  mcompand: "Per-band compression",
  mono: "Both channels collapsed into one",
  mstlr: "Mid/side decoded to left/right",
  mstrr: "Mid/side decoded, reversed",
  nightcore: "Faster and higher",
  normalizer: "Evens out the volume",
  phaser: "Sweeping notch filter",
  pulsator: "Volume pumps in and out",
  reverse: "Plays it backwards",
  softlimiter: "Catches the peaks gently",
  subboost: "Sub-bass only",
  surrounding: "Wider than stereo",
  treble: "Lifts the high end",
  tremolo: "Wobbling volume",
  vaporwave: "Slower and lower",
  vibrato: "Wobbling pitch",
};

const NAMES = Object.keys(FILTERS);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("filter")
    .setDescription("Toggle an audio filter.")
    .addStringOption(option =>
      option.setName("filter")
        .setDescription("The filter to toggle, or 'clear' to drop them all.")
        .setRequired(true)
        .setAutocomplete(true)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    // `includes`, not `startsWith`: typing "boost" used to match neither bassboost nor subboost.
    const matches = NAMES.filter(name => name.includes(focused)).slice(0, 24);
    const choices = matches.map(name => ({ name: `${name}: ${FILTERS[name]}`.slice(0, 100), value: name }));
    if ("clear".includes(focused)) choices.unshift({ name: "clear: turn every filter off", value: "clear" });
    await interaction.respond(choices.slice(0, 25));
  },

  async execute(interaction) {
    const { queue, failed } = await resolveMusicContext(interaction, { requireTrack: false });
    if (failed) return;

    const filter = interaction.options.getString("filter");
    const ffmpeg = queue.filters?.ffmpeg;

    if (!ffmpeg) {
      return interaction.reply({ embeds: [musicErrorEmbed(interaction, "The filter chain is not up. Start something playing first.")] });
    }

    if (filter !== "clear" && !NAMES.includes(filter)) {
      return interaction.reply({
        embeds: [musicErrorEmbed(interaction, `**${filter}** is not a filter I have. Pick one from the autocomplete.`)],
      });
    }

    await interaction.deferReply();

    try {
      if (filter === "clear") {
        const enabled = ffmpeg.getFiltersEnabled();
        if (!enabled.length) {
          return interaction.editReply({ embeds: [await musicEmbed(interaction, "🎶 No filters were on to begin with.")] });
        }
        // One toggle for the whole set. Awaiting them one at a time restarted the ffmpeg chain once per filter.
        await ffmpeg.toggle(enabled);
        return interaction.editReply({
          embeds: [await musicEmbed(interaction, `🎶 Dropped ${enabled.length} filter${enabled.length === 1 ? "" : "s"}: ${enabled.map(f => `\`${f}\``).join(", ")}`)],
        });
      }

      await ffmpeg.toggle([filter]);
      const on = ffmpeg.isEnabled(filter);
      return interaction.editReply({
        embeds: [await musicEmbed(interaction, `🎶 **${filter}** is now **${on ? "on" : "off"}**. ${FILTERS[filter]}.\n-# Changing a filter rebuilds the audio chain, so the current song restarts.`)],
      });
    } catch (error) {
      logger.error(`[Filter] Toggling "${filter}" failed: ${error.message}`);
      return interaction.editReply({ embeds: [musicErrorEmbed(interaction, `Could not apply **${filter}**. The audio chain refused it.`)] });
    }
  },
};
