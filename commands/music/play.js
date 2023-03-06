const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const wait = require('util').promisify(setTimeout);
const logger = require('../../utils/logger');
const { randomHexColor } = require('../../utils/randomcolor');

module.exports = {
    data: new SlashCommandBuilder()
        .setName("play")
        .setDescription("Play a song.")
        .addStringOption(option => option.setName("song").setDescription("The song to play.").setRequired(true)),
    async execute(interaction) {
        const player = interaction.client.player;
        const embed = new EmbedBuilder()
        .setColor(randomHexColor())
        .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true}) })
        .setTimestamp();

        if (!interaction.member.voice.channelId) {
            embed.setTitle("You are not in a voice channel!");
            embed.setDescription("You must be in a voice channel to use this command.");
            return await interaction.reply({embeds: [embed], ephemeral: true});
        }
        if (interaction.guild.members.me.voice.channelId && interaction.member.voice.channelId !== interaction.guild.members.me.voice.channelId) {
            embed.setTitle("You are not in my voice channel!");
            embed.setDescription("You must be in my voice channel to use this command.");
            return await interaction.reply({embeds: [embed], ephemeral: true});
        }
        await interaction.deferReply({ ephemeral: true });
        const song = interaction.options.getString("song");
        const queue = player.nodes.create(interaction.guild, {
            leaveOnEnd: true,
            leaveOnEndCooldown: 60000,
            leaveOnStop: true,
            leaveOnEmpty: true,
            leaveOnEmptyCooldown: 300000,
            skipOnNoStream: true,
            repeatMode: 0,
            intialVolume: 100,
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
            if (!queue.connection) await queue.connect(interaction.member.voice.channelId);
        } catch (error) {
            logger.error(error);
            embed.setTitle("Could not join voice channel!");
            embed.setDescription("I could not join your voice channel. Please make sure I have permission to join and speak in your voice channel.");
            return await interaction.editReply({embeds: [embed], ephemeral: true});
        }

        const results = await player.search(song);
        if (!results.hasTracks()) {
            embed.setTitle("No results found!");
            embed.setDescription(`No results found for ${song}`);
            await interaction.editReply({embeds: [embed], ephemeral: true});
        }
        logger.debug(results);
        if (song.startsWith("http")) {
            if (results.playlist) {
                if (results.playlist.type == "playlist" || results.playlist.type == "album") {
                    const playlist = results.playlist;
                    if (queue.metadata) {
                        embed.setTitle(`Added ${results.playlist.type} to queue!`);
                        embed.setDescription(`[${playlist.title}](${playlist.url})\nBy **${playlist.author.name}** | ${playlist.tracks.length} songs`);
                        embed.setThumbnail(playlist.thumbnail.url || playlist.thumbnail);
                        await interaction.editReply({embeds: [embed], ephemeral: true});
                    }
                    await queue.addTrack(playlist);
                    if (!queue.isPlaying()) await queue.node.play();
                } 
            } else {
                const track = results.tracks[0];
                if (queue.metadata) {
                    embed.setTitle("Added to queue!");
                    embed.setDescription(`[${track.title}](${track.url})\nBy **${track.author}**${track.views > 0 ? ` | **${track.views}** views` : ``}`);
                    embed.setThumbnail(track.thumbnail);
                    await interaction.editReply({embeds: [embed], ephemeral: true});
                }
                await queue.addTrack(track);
                if (!queue.isPlaying()) await queue.node.play();
            }
            await wait(10000);
            await interaction.deleteReply();
        } else {
            embed.setTitle("Multiple results found!");
            embed.setDescription(`Please select a song from the menu below.`);
            embed.setThumbnail(`https://lh3.googleusercontent.com/bzQGw1aGEkHb_cg09JtbnzTzhDdllGX4oEUhAEhaiBABz-h-pywkW4iLtwrmz4nZVt9-BsIIWzglQtBQPY0eTZvUy8rVMzfvh7f0HkNFZ-f173KsJQw=v0-s1050`);
            const row = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId("search")
                        .setPlaceholder("Select a song")
                        .addOptions(results.tracks.map((track, index) => {
                            return {
                                label: track.title,
                                value: index.toString(),
                                description: `By ${track.author} | ${track.duration}`
                            };
                        }))
                );
            await interaction.editReply({embeds: [embed], components: [row], ephemeral: true});
            const filter = i => i.customId === "search";
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });
            collector.on("collect", async i => {
                if (i.user.id !== interaction.user.id) {
                    await i.update({content: "You cannot use this menu.", ephemeral: true});
                    return;
                }
                const track = results.tracks[parseInt(i.values[0])];
                if (queue.metadata) {
                    embed.setTitle("Added to queue!");
                    embed.setDescription(`[${track.title}](${track.url})\nBy **${track.author}**${track.views > 0 ? ` | **${track.views}** views` : ``}`);
                    embed.setThumbnail(track.thumbnail);
                    await interaction.editReply({embeds: [embed], components: [], ephemeral: true});
                    await collector.stop("success");
                }
                await queue.addTrack(track);
                if (!queue.isPlaying()) await queue.node.play();
            });
            collector.on("end", async (collected, reason) => {
                logger.debug(`Play command collector ended. Collected ${collected.size} interactions. Reason: ${reason}`)
                if (reason === "time") {
                    embed.setTitle("Request has timed out.").setDescription(`Request has timed out. Please try again.`);
                    await interaction.editReply({embed: [embed], components: [], ephemeral: true});
                }
                if (reason === "success") {
                    await wait(10000); 
                    await interaction.deleteReply();
                }
            });
        }
    }
};
