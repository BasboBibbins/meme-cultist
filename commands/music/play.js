const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { QueryType, useMainPlayer } = require('discord-player');
const wait = require('util').promisify(setTimeout);
const logger = require('../../utils/logger');
const crypto = require('crypto');
const { randomHexColor } = require('../../utils/randomcolor');

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

        const embed = new EmbedBuilder()
            .setColor(randomHexColor())
            .setFooter({
                text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`,
                iconURL: interaction.client.user.displayAvatarURL({ dynamic: true })
            })
            .setTimestamp();

        // Voice channel checks
        const userChannel = interaction.member.voice.channel;
        const botChannel = interaction.guild.members.me.voice.channel;

        if (!userChannel) {
            embed.setTitle("You are not in a voice channel!");
            embed.setDescription("You must be in a voice channel to use this command.");
            return await interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (botChannel && botChannel.id !== userChannel.id) {
            embed.setTitle("You are not in my voice channel!");
            embed.setDescription("You must be in my voice channel to use this command.");
            return await interaction.reply({ embeds: [embed], ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        const song = interaction.options.getString("song");

        const queue = player.nodes.create(interaction.guild, {
            initialVolume: 100,
            leaveOnEnd: true,
            leaveOnEndCooldown: 60000,
            leaveOnStop: true,
            leaveOnEmpty: true,
            leaveOnEmptyCooldown: 300000,
            skipOnNoStream: true,
            repeatMode: 0,
            equalizer: [
                { band: 0, gain: 0.15 },
                { band: 1, gain: 0.10 },
                { band: 2, gain: 0.05 }
            ],
            metadata: {
                channel: interaction.channel,
                requestedBy: interaction.user
            }
        });

        try {
            if (!queue.connection) await queue.connect(userChannel);
        } catch (error) {
            logger.error(error);
            embed.setTitle("Could not join voice channel!");
            embed.setDescription("Make sure I have permission to join and speak.");
            return await interaction.editReply({ embeds: [embed], ephemeral: true });
        }

        const results = await player.search(song, { requestedBy: interaction.user, searchEngine: QueryType.AUTO });

        if (!results || !results.tracks.length) {
            embed.setTitle("No results found!");
            embed.setDescription(`No results found for "${song}".`);
            return await interaction.editReply({ embeds: [embed], ephemeral: true });
        }

        const isPlaylist = results.playlist && (results.playlist.type === "playlist" || results.playlist.type === "album");

        if (song.startsWith("http") && (isPlaylist || results.tracks.length === 1)) {
            if (isPlaylist) {
                const playlist = results.playlist;

                embed.setTitle(`Added ${playlist.type} to queue!`);
                embed.setDescription(`[${playlist.title}](${playlist.url})\nBy **${playlist.author.name}** | ${playlist.tracks.length} songs`);
                embed.setThumbnail(playlist.thumbnail?.url || playlist.thumbnail);
                await interaction.editReply({ embeds: [embed], ephemeral: true });

                queue.addTrack(playlist.tracks); // ✅ Add array of tracks
            } else {
                const track = results.tracks[0];
                embed.setTitle("Added to queue!");
                embed.setDescription(`[${track.title}](${track.url})\nBy **${track.author}**${track.views > 0 ? ` | **${track.views}** views` : ``}`);
                embed.setThumbnail(track.thumbnail);
                await interaction.editReply({ embeds: [embed], ephemeral: true });

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
                return await interaction.editReply({ embeds: [embed], ephemeral: true });
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

            await interaction.editReply({ embeds: [embed], components: [row], ephemeral: true });

            const filter = i => i.customId === "search";
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

            collector.on("collect", async i => {
                if (i.user.id !== interaction.user.id) {
                    return await i.reply({ content: "You cannot use this menu.", ephemeral: true });
                }

                const track = results.tracks[parseInt(i.values[0])];
                logger.debug(`User ${i.user.tag} selected ${track.title} from the search results.`);
                embed.setTitle("Added to queue!");
                embed.setDescription(`[${track.title}](${track.url})\nBy **${track.author}**${track.views > 0 ? ` | **${track.views}** views` : ``}`);
                embed.setThumbnail(track.thumbnail);

                queue.addTrack(track);
                try {
                    if (!queue.isPlaying()) {
                        await player.play(userChannel.id, track, {
                            nodeOptions: {
                                metadata: { channel: userChannel }
                            }
                        });
                    }
                } catch (error) {
                    logger.error("Error while playing the queue:");
                    console.log(error);
                    embed.setTitle("Playback Error");
                    embed.setDescription("An error occurred while trying to play the song. Please try again.");
                    collector.stop("error");
                }

                await i.update({ embeds: [embed], components: [], ephemeral: true });
                collector.stop("success");
            });

            collector.on("end", async (collected, reason) => {
                logger.debug(`Play command collector ended. Collected ${collected.size} interactions. Reason: ${reason}`);
                if (reason === "time") {
                    embed.setTitle("Request has timed out.").setDescription(`Request has timed out. Please try again.`);
                    await interaction.editReply({ embeds: [embed], components: [], ephemeral: true });
                }
                if (reason === "success") {
                    await wait(10000);
                    await interaction.deleteReply();
                }
            });
        }
    }
};
