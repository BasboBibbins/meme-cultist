const { SlashCommandBuilder } = require("discord.js");
const logger = require("../../utils/logger");
const { Client: GeniusClient } = require("genius-lyrics");
const { musicEmbed, musicErrorEmbed } = require("../../utils/music/embeds");
const { formatLyrics, truncate, queryFor } = require("../../utils/music/lyrics");

const genius = new GeniusClient(process.env.GENIUS_API_KEY);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("lyrics")
    .setDescription("Get the lyrics of the current song, or one you name.")
    .addStringOption(option =>
      option.setName("song")
        .setDescription("The song to look up. Defaults to whatever is playing.")
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply();

    const currentTrack = interaction.client.player?.nodes?.get(interaction.guild.id)?.currentTrack;
    let song = interaction.options.getString("song");

    if (!song) {
      if (!currentTrack) {
        return interaction.editReply({
          embeds: [musicErrorEmbed(interaction, "Nothing is playing, so there is nothing to look up. Name a song with `/lyrics <song>`.")],
        });
      }
      song = queryFor(currentTrack);
    }

    if (typeof song !== "string" || song.trim() === "") {
      return interaction.editReply({ embeds: [musicErrorEmbed(interaction, "That is not a song name.")] });
    }

    let songData;
    try {
      const searches = await genius.songs.search(song);
      songData = searches?.[0];
    } catch (err) {
      logger.error(`[Lyrics] Genius search failed for "${song}": ${err.stack || err}`);
      return interaction.editReply({ embeds: [musicErrorEmbed(interaction, "Genius is not answering. Try again in a bit.")] });
    }

    if (!songData) {
      return interaction.editReply({ embeds: [musicErrorEmbed(interaction, `Genius has nothing for "${song}".`)] });
    }

    let lyrics;
    try {
      lyrics = await songData.lyrics();
    } catch (err) {
      logger.error(`[Lyrics] Could not fetch lyrics for "${song}": ${err.stack || err}`);
      return interaction.editReply({
        embeds: [musicErrorEmbed(interaction, `Found **${songData.title}** but could not pull the lyrics off Genius.`)],
      });
    }

    if (!lyrics || !lyrics.trim()) {
      return interaction.editReply({
        embeds: [musicErrorEmbed(interaction, `Genius has a page for **${songData.title}** but no lyrics on it.`)],
      });
    }

    const { text, truncated } = truncate(formatLyrics(lyrics).trim(), songData.url);
    const embed = await musicEmbed(interaction, text);
    embed.setAuthor({ name: `${songData.title} by ${songData.artist.name}`.slice(0, 256), url: songData.url, iconURL: songData.thumbnail });
    if (truncated) logger.debug(`[Lyrics] Truncated "${songData.title}" to fit the embed.`);

    return interaction.editReply({ embeds: [embed] });
  },
};
