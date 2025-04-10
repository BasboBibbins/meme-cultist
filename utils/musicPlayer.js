const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const wait = require("util").promisify(setTimeout);
const logger = require("../utils/logger");
const { randomHexColor } = require("./randomcolor");

let msg = null; 

module.exports = {
    currentTrack: null,
    trackStart: async (client, queue, track) => {
        if (msg != null) return; // Prevents multiple messages from being sent
        const channel = queue.metadata.channel;
        const requestedBy = queue.options.metadata.requestedBy;
        module.exports.currentTrack = track;
        const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId("pause")
                .setLabel("Pause")
                .setStyle(ButtonStyle.Primary)
                .setEmoji("⏸️"),
            new ButtonBuilder()
                .setCustomId("skip")
                .setLabel("Skip")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("⏭️"),
            new ButtonBuilder()
                .setCustomId("stop")
                .setLabel("Stop")
                .setStyle(ButtonStyle.Danger)
                .setEmoji("⏹️"),
        );
        const desc = `[${track.title}](${track.url})\nBy **${track.author}**${track.views > 0 ? ` | **${track.views}** views` : ``}`;
        let currentQueue = {};
        queue.tracks.map((track, index) => {
            currentQueue[index] = track;
        });
        const player = new EmbedBuilder()
        .setTitle(`🎧 Now Playing ${queue.dispatcher.channel.name ? `in ${queue.dispatcher.channel.name}` : ""}`)
        .setAuthor({ name: `Requested by ${requestedBy.displayName }`, iconURL: requestedBy.displayAvatarURL({dynamic: true}) })
        .setDescription(`${desc}\n\n${track.isStream ? `🔴 LIVE` : `🔘 ${queue.node.createProgressBar()} 🔘`}\n\n${Object.keys(currentQueue).length > 0 ? `Up Next: [${currentQueue[0].title}](${currentQueue[0].url})\nBy **${currentQueue[0].author}**` : ``}`)
        .setThumbnail(track.thumbnail)
        .setColor(randomHexColor())
        .setFooter({ text: `${interaction.client.user.username} | Version ${require('../package.json').version}`, iconURL: client.user.displayAvatarURL({dynamic: true}) })
        .setTimestamp();

        msg = await channel.send({embeds: [player], components: [row]});

        const interval = setInterval(async () => {
            currentQueue = {};
            queue.tracks.map((track, index) => {
                currentQueue[index] = track;
            });
            if (!queue.node.isPlaying() || queue.node.isPaused() || track.isStream) return clearInterval(interval);
            player.setDescription(`${desc}\n\n${track.isStream ? `🔴 LIVE` : `🔘 ${queue.node.createProgressBar()} 🔘`}${Object.keys(currentQueue).length > 0 ? `\n\nUp Next: [${currentQueue[0].title}](${currentQueue[0].url})\nBy **${currentQueue[0].author}**` : ``}`);
            await msg.edit({embeds: [player], components: [row]});
        }, 1000);

        const filter = i => i.member.voice.channelId === queue.dispatcher.channel.id;
        const collector = await msg.createMessageComponentCollector({ filter, time: (track.durationMS - queue.node.getTrackPosition()) });
    
        collector.on('collect', async i => {
            if (!filter) return await i.reply({ content: `Join the bot's channel to use these buttons!`, ephemeral: true }); 
            logger.debug(`${i.member.user.displayName } pressed ${i.customId}`);
            if (i.customId === "pause") {
                queue.node.isPaused() ? await queue.node.resume() : await queue.node.pause();
                await collector.resetTimer({ time: 300000 }); // 5 minutes to respond
                player.setTitle(queue.node.isPaused() ? `⏸️ Song Paused` : `🎧 Now Playing ${queue.dispatcher.channel.name ? `in ${queue.dispatcher.channel.name}` : ""}`);
                row.components[0].setLabel(queue.node.isPaused() ? "Resume" : "Pause").setEmoji(queue.node.isPaused() ? "▶️" : "⏸️");
                row.components[1].setDisabled(queue.node.isPaused());
                await i.update({embeds: [player], components: [row]});
            } else if (i.customId === "skip") {
                try {
                    if (queue.node.isPaused()) {
                        // TODO: fix the bot creating two message when the user tries to skip while paused
                        return await i.reply({ content: `Unpause before trying to skip. Too lazy to fix this bug for now.`, ephemeral: true });
                    }
                    await queue.node.skip();
                    if (msg) await msg.delete();
                    await collector.stop();
                } catch (e) {
                    logger.error(e);
                }
            } else if (i.customId === "stop") {
                try {
                    await queue.delete();
                    if (msg) await msg.delete();
                    return await collector.stop();
                } catch (e) {
                    logger.error(e);
                }
            }
        });
    
        collector.on('end', ( collected, reason ) => {
            logger.debug(`Collected ${collected.size} interactions. Reason: ${reason}`);
            if (reason === "time") {
                if (queue.node.isPaused()) {
                    const reply = msg.reply(`Are you still there? Music will be stopped in 30 seconds if you don't respond.`);
                    wait(30000).then(async () => {
                        if (queue.node.isPaused()) {
                            await queue.delete();
                            if (msg) msg.delete();
                            if (reply) await reply.delete();
                        } else {
                            if (reply) await reply.delete();
                        }
                    });
                } 
            }
            clearInterval(interval);
        });
    },
    trackEnd: async (client, queue, track) => {
        msg = null;
        module.exports.currentTrack = null;
    },
    queueString: (tracks) => {
        let result = tracks.map((track, i) => `**${i + 1}.** [${track.title}](${track.url}) by **${track.author}** - ${track.duration}`).join("\n");
        if (result.length > 3584) {
            result = result.substring(0, 3584);
            result = result.substring(0, result.lastIndexOf("\n"));
            result += "\n...";
        }
        return result;
    }
};