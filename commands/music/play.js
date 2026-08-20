const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require("discord.js");
const { QueryType } = require("discord-player");
const logger = require("../../utils/logger");
const { isYoutubePlaylist, expandYoutubePlaylist, enrichAppleMusicTracks } = require("../../utils/music/stream");
const { musicEmbed, musicErrorEmbed } = require("../../utils/music/embeds");
const { resolveMusicContext } = require("../../utils/music/guards");
const { autoDismiss } = require("../../utils/music/dismiss");

const SEARCH_TIMEOUT_MS = 60000;
const CONFIRM_VISIBLE_MS = 10000;

// The engine owns the audio path now, so a session needs nothing but somewhere to report to.
// The DSP flags that used to live here belonged to discord-player and no longer have a reader.
function sessionOptions(interaction) {
  return {
    metadata: {
      channel: interaction.channel,
      requestedBy: interaction.user,
    },
  };
}

function trackSummary(track) {
  const views = track.views > 0 ? ` | **${track.views.toLocaleString("en-US")}** views` : "";
  return `[${track.title}](${track.url})\nBy **${track.author}**${views}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song.")
    .addStringOption(option =>
      option.setName("song")
        .setDescription("A link, or something to search for.")
        .setRequired(true)
    ),

  async execute(interaction) {
    const player = interaction.client.player;

    // requireQueue is off: /play is the command that creates the queue every other music command requires.
    const { voiceChannel: userChannel, failed } = await resolveMusicContext(interaction, { requireQueue: false });
    if (failed) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const song = interaction.options.getString("song");
    const embed = await musicEmbed(interaction);

    const queue = player.nodes.create(interaction.guild, sessionOptions(interaction));

    let results;
    try {
      results = await player.search(song, { requestedBy: interaction.user, searchEngine: QueryType.AUTO });
    } catch (error) {
      logger.error(`[Play] Search threw for "${song}": ${error.message}`);
      logger.error(error.stack);
      return interaction.editReply({
        embeds: [musicErrorEmbed(interaction, "That search fell over on the way out. Try it again.")],
      });
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
        await interaction.editReply({
          embeds: [musicErrorEmbed(interaction, `I cannot get into **${userChannel.name}**. Check that I am allowed to join and speak in there.`)],
        });
        return false;
      }
    };

    // Resolving a stream mints a PO token and spawns yt-dlp, which measured around ten seconds.
    // An interaction has three, so this is never awaited before one is acknowledged; the engine
    // reports a failed start through playerError, which bot.js already turns into a message.
    const startIfIdle = () => {
      queue.node.play().catch(error => logger.error(`[Play] Could not start playback: ${error.message}`));
    };

    // The extractor resolves a playlist title but none of its entries, so tracks are recovered from yt-dlp before this counts as a miss.
    if ((!results || !results.tracks.length) && isYoutubePlaylist(song)) {
      const recovered = await expandYoutubePlaylist(song, player, interaction.user);
      if (recovered.length) {
        logger.log(`[Play] Recovered ${recovered.length} track(s) from playlist via yt-dlp`);
        if (!await connect()) return;
        queue.addTrack(recovered);
        embed.setTitle("Playlist queued")
          .setDescription(`**${recovered.length}** tracks in. First up: [${recovered[0].title}](${recovered[0].url})`)
          .setThumbnail(recovered[0].thumbnail || null);
        await interaction.editReply({ embeds: [embed] });
        startIfIdle();
        return autoDismiss(interaction, CONFIRM_VISIBLE_MS);
      }
    }

    if (!results || !results.tracks.length) {
      // Zero results is almost always a broken extractor rather than an obscure query.
      const loaded = player.extractors.store.map(e => e.identifier).join(", ") || "NONE";
      logger.warn(`[Play] No results for "${song}". Active extractors: ${loaded}`);
      return interaction.editReply({
        embeds: [musicErrorEmbed(interaction, `Nothing came back for "${song}". Either it does not exist or I am being lied to.`)],
      });
    }

    if (!await connect()) return;

    const isPlaylist = results.playlist && (results.playlist.type === "playlist" || results.playlist.type === "album");

    if (song.startsWith("http") && (isPlaylist || results.tracks.length === 1)) {
      if (isPlaylist) {
        const playlist = results.playlist;
        embed.setTitle(`${playlist.type === "album" ? "Album" : "Playlist"} queued`)
          .setDescription(`[${playlist.title}](${playlist.url})\nBy **${playlist.author?.name ?? "Unknown"}** | ${playlist.tracks.length} songs`)
          .setThumbnail(playlist.thumbnail?.url || playlist.thumbnail || null);
        await interaction.editReply({ embeds: [embed] });
        queue.addTrack(playlist.tracks);
      } else {
        const track = results.tracks[0];
        embed.setTitle("Queued").setDescription(trackSummary(track)).setThumbnail(track.thumbnail || null);
        await interaction.editReply({ embeds: [embed] });
        queue.addTrack(track);
      }

      startIfIdle();
      return autoDismiss(interaction, CONFIRM_VISIBLE_MS);
    }

    // Discord rejects an empty select label, and a bridged track can carry one.
    const choices = results.tracks.slice(0, 25)
      .map((track, index) => ({ track, index }))
      .filter(({ track }) => typeof track.title === "string" && track.title.trim().length > 0);

    if (!choices.length) {
      return interaction.editReply({
        embeds: [musicErrorEmbed(interaction, `Everything that came back for "${song}" was unplayable garbage. Try different words.`)],
      });
    }

    // Namespaced per invocation: a shared customId let two concurrent /play calls in one channel collect each other's selections.
    const menuId = `play:search:${interaction.id}`;

    embed.setTitle("Which one?").setDescription("Pick from the menu. It expires in a minute.");
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuId)
        .setPlaceholder("Select a song")
        .addOptions(choices.map(({ track, index }) => ({
          label: track.title.substring(0, 100),
          description: [track.author, track.duration].filter(Boolean).join(" | ").substring(0, 100) || "Unknown",
          value: String(index),
        })))
    );

    const reply = await interaction.editReply({ embeds: [embed], components: [row] });

    // Scoped to the reply rather than the channel, so no other invocation can see it.
    const collector = reply.createMessageComponentCollector({
      filter: i => i.customId === menuId && i.user.id === interaction.user.id,
      time: SEARCH_TIMEOUT_MS,
      max: 1,
    });

    collector.on("collect", async i => {
      const track = results.tracks[parseInt(i.values[0], 10)];
      logger.debug(`[Play] ${i.user.tag} selected "${track.title}" from the search results.`);

      queue.addTrack(track);
      embed.setTitle("Queued").setDescription(trackSummary(track)).setThumbnail(track.thumbnail || null);

      // Acknowledged before playback starts, not after. Awaiting the start here is what made the
      // menu report that the bot never responded, while the track queued and played regardless.
      await i.update({ embeds: [embed], components: [] })
        .catch(err => logger.debug(`[Play] Could not confirm the selection: ${err.message}`));
      startIfIdle();
    });

    collector.on("end", async (collected, reason) => {
      logger.debug(`[Play] Search collector ended after ${collected.size} interaction(s). Reason: ${reason}`);
      if (collected.size > 0) return autoDismiss(interaction, CONFIRM_VISIBLE_MS);
      if (reason !== "time") return;
      embed.setTitle("Timed out").setDescription("You took too long. Run `/play` again.");
      await interaction.editReply({ embeds: [embed], components: [] })
        .catch(err => logger.debug(`[Play] Could not report the timeout: ${err.message}`));
      return autoDismiss(interaction, CONFIRM_VISIBLE_MS);
    });
  },
};
