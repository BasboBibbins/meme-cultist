const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require("discord.js");
const { QueryType, useMainPlayer } = require("discord-player");
const wait = require("util").promisify(setTimeout);
const logger = require("../../utils/logger");
const { beforeCreateStream, afterStreamExtracted, isYoutubePlaylist, expandYoutubePlaylist, enrichAppleMusicTracks } = require("../../utils/musicStream");
const { buildInfoEmbed } = require("../../utils/embeds");
const { resolveMusicContext } = require("../../utils/musicGuards");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song.")
    .addStringOption(option =>
      option.setName("song")
        .setDescription("The song to play.")
        .setRequired(true)
    ),

  async execute(interaction) {
    const player = useMainPlayer();

    const embed = buildInfoEmbed(interaction.user, interaction.client);

    // requireQueue is off: /play is the command that creates the queue every other music command requires.
    const { voiceChannel: userChannel, failed } = await resolveMusicContext(interaction, { requireQueue: false });
    if (failed) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const song = interaction.options.getString("song");

    // No equalizer: the option lands on EqualizerStream as `bandMultiplier`, which wants {band, gain}[] and silently discards a flat array, so the bass lift here never applied while its transform still ran 15 biquad bands per sample against the audio frame clock. Re-adding one needs the object form AND a fix for the processor being built with channelCount 1 over interleaved stereo.
    const queue = player.nodes.create(interaction.guild, {
      leaveOnEnd: true,
      leaveOnEndCooldown: 60000,
      leaveOnStop: true,
      leaveOnEmpty: true,
      leaveOnEmptyCooldown: 300000,
      skipOnNoStream: true,
      repeatMode: 0,
      metadata: {
        channel: interaction.channel,
        requestedBy: interaction.user
      },
      async onBeforeCreateStream(track, _source, _queue) {
        try {
          return await beforeCreateStream(track);
        } catch (error) {
          logger.error(`[Play] Stream setup failed for "${track.title}": ${error.message}`);
          throw error;
        }
      },
      // The queue must be forwarded — the DRM fallback reaches the player through it.
      async onStreamExtracted(stream, track, queue) {
        return afterStreamExtracted(stream, track, queue);
      }
    });

    let results;
    try {
      results = await player.search(song, { requestedBy: interaction.user, searchEngine: QueryType.AUTO });
    } catch (error) {
      logger.error(`[Play] Search threw for "${song}": ${error.message}`);
      logger.error(error.stack);
      embed.setTitle("Search failed!");
      embed.setDescription("Something went wrong searching for that. Please try again.");
      return await interaction.editReply({ embeds: [embed] });
    }

    logger.debug(`[Play] "${song}" -> ${results?.tracks?.length ?? 0} track(s), playlist=${results?.playlist?.title ?? "none"}, extractor=${results?.extractor?.identifier ?? "none"}`);

    // Apple Music reports every artist as "Apple Music"; resolving it before queueing also fixes the query the YouTube bridge builds.
    await enrichAppleMusicTracks(results?.tracks);

    // Joining only once something is playable keeps the bot out of the channel on a failed lookup instead of sitting there silently.
    const connect = async () => {
      if (queue.connection) return true;
      try {
        await queue.connect(userChannel);
        return true;
      } catch (error) {
        logger.error(`[Play] Could not join voice channel: ${error.message}`);
        embed.setTitle("Could not join voice channel!");
        embed.setDescription("Make sure I have permission to join and speak.");
        await interaction.editReply({ embeds: [embed] });
        return false;
      }
    };

    // The extractor resolves a playlist title but none of its entries, so tracks are recovered from yt-dlp before this counts as a miss.
    if ((!results || !results.tracks.length) && isYoutubePlaylist(song)) {
      const recovered = expandYoutubePlaylist(song, player, interaction.user);
      if (recovered.length) {
        logger.log(`[Play] Recovered ${recovered.length} track(s) from playlist via yt-dlp`);
        if (!await connect()) return;
        queue.addTrack(recovered);
        embed.setTitle("Added playlist to queue!");
        embed.setDescription(`**${recovered.length}** tracks queued.\nFirst up: [${recovered[0].title}](${recovered[0].url})`);
        embed.setThumbnail(recovered[0].thumbnail || null);
        await interaction.editReply({ embeds: [embed] });
        if (!queue.isPlaying()) await queue.node.play();
        await wait(10000);
        return await interaction.deleteReply();
      }
    }

    if (!results || !results.tracks.length) {
      // Zero results is almost always a broken extractor rather than an obscure query.
      const loaded = player.extractors.store.map(e => e.identifier).join(", ") || "NONE";
      logger.warn(`[Play] No results for "${song}". Active extractors: ${loaded}`);
      embed.setTitle("No results found!");
      embed.setDescription(`No results found for "${song}".`);
      return await interaction.editReply({ embeds: [embed] });
    }

    if (!await connect()) return;

    const isPlaylist = results.playlist && (results.playlist.type === "playlist" || results.playlist.type === "album");

    if (song.startsWith("http") && (isPlaylist || results.tracks.length === 1)) {
      if (isPlaylist) {
        const playlist = results.playlist;

        embed.setTitle(`Added ${playlist.type} to queue!`);
        embed.setDescription(`[${playlist.title}](${playlist.url})\nBy **${playlist.author.name}** | ${playlist.tracks.length} songs`);
        embed.setThumbnail(playlist.thumbnail?.url || playlist.thumbnail);
        await interaction.editReply({ embeds: [embed] });

        queue.addTrack(playlist.tracks); // ✅ Add array of tracks
      } else {
        const track = results.tracks[0];
        embed.setTitle("Added to queue!");
        embed.setDescription(`[${track.title}](${track.url})\nBy **${track.author}**${track.views > 0 ? ` | **${track.views}** views` : ""}`);
        embed.setThumbnail(track.thumbnail);
        await interaction.editReply({ embeds: [embed] });

        queue.addTrack(track);
      }

      if (!queue.isPlaying()) await queue.node.play();

      await wait(10000);
      await interaction.deleteReply();
    } else {
      const options = results.tracks.slice(0, 25).map((track, index) => ({
        label: track.title.substring(0, 100),
        description: `By ${track.author} | ${track.duration}`.substring(0, 100),
        value: index.toString()
      }));

      if (!options.length) {
        embed.setTitle("No valid results found!");
        embed.setDescription(`No valid results were found for "${song}".`);
        return await interaction.editReply({ embeds: [embed] });
      }

      embed.setTitle("Multiple results found!");
      embed.setDescription("Please select a song from the menu below.");
      embed.setThumbnail("https://lh3.googleusercontent.com/bzQGw1aGEkHb_cg09JtbnzTzhDdllGX4oEUhAEhaiBABz-h-pywkW4iLtwrmz4nZVt9-BsIIWzglQtBQPY0eTZvUy8rVMzfvh7f0HkNFZ-f173KsJQw=v0-s1050");

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("search")
          .setPlaceholder("Select a song")
          .addOptions(options)
      );

      await interaction.editReply({ embeds: [embed], components: [row] });

      const filter = i => i.customId === "search";
      const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

      collector.on("collect", async i => {
        if (i.user.id !== interaction.user.id) {
          return await i.reply({ content: "You cannot use this menu.", flags: MessageFlags.Ephemeral });
        }

        const track = results.tracks[parseInt(i.values[0])];
        logger.debug(`User ${i.user.tag} selected ${track.title} from the search results.`);
        embed.setTitle("Added to queue!");
        embed.setDescription(`[${track.title}](${track.url})\nBy **${track.author}**${track.views > 0 ? ` | **${track.views}** views` : ""}`);
        embed.setThumbnail(track.thumbnail);

        queue.addTrack(track);
        try {
          if (!queue.isPlaying()) {
            await queue.node.play();
          }
        } catch (error) {
          logger.error("Error while playing the queue:");
          console.log(error);
          embed.setTitle("Playback Error");
          embed.setDescription("An error occurred while trying to play the song. Please try again.");
          collector.stop("error");
        }

        await i.update({ embeds: [embed], components: [] });
        collector.stop("success");
      });

      collector.on("end", async (collected, reason) => {
        logger.debug(`Play command collector ended. Collected ${collected.size} interactions. Reason: ${reason}`);
        if (reason === "time") {
          embed.setTitle("Request has timed out.").setDescription("Request has timed out. Please try again.");
          await interaction.editReply({ embeds: [embed], components: [] });
        }
        if (reason === "success") {
          await wait(10000);
          await interaction.deleteReply();
        }
      });
    }
  }
};
