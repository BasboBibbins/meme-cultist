const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const wait = require("util").promisify(setTimeout);
const logger = require("../utils/logger");

module.exports = {
    trackStart: async (client, queue, track) => {
        //console.log(queue)
        //console.log(track)
        const channel = queue.metadata.channel;
        const requestedBy = queue.options.metadata.requestedBy;
        
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
        const player = new EmbedBuilder()
        .setTitle(`🎧 Now Playing ${queue.dispatcher.channel.name ? `in ${queue.dispatcher.channel.name}` : ""}`)
        .setAuthor({ name: `Requested by ${requestedBy.username}`, iconURL: requestedBy.displayAvatarURL({dynamic: true}) })
        .setDescription(`${desc}\n\n${track.isStream ? `🔴 LIVE` : `🔘 ${queue.node.createProgressBar()} 🔘`}\n\n${queue.tracks.length < 0 ? `Up Next: [${queue.tracks[0].title}](${queue.tracks[0].url})\n By **${queue.tracks[0].author}**` : ``}`)
        .setThumbnail(track.thumbnail)
        .setColor(0x00AE86)
        .setFooter({ text: `Meme Cultist | Version ${require('../package.json').version}`, iconURL: client.user.displayAvatarURL({dynamic: true}) })
        .setTimestamp();

        let msg = await channel.send({embeds: [player], components: [row]});
        console.log(queue.tracks)

        const interval = setInterval(async () => {
            if (!queue.node.isPlaying() || queue.node.isPaused() || track.isStream) return clearInterval(interval);
            player.setDescription(`${desc}\n\n${track.isStream ? `🔴 LIVE` : `🔘 ${queue.node.createProgressBar()} 🔘`}${queue.tracks.length > 0 ? `\n\n Up Next: [${queue.tracks[0].title}](${queue.tracks[0].url})\n By **${queue.tracks[0].author}**` : ""}`)
            await msg.edit({embeds: [player], components: [row]});
        }, 1000);

        const filter = i => {
            logger.log(`${i.member.voice.channelId} === ${queue.dispatcher.channel.id} = ${i.member.voice.channelId === queue.dispatcher.channel.id}`)
            return i.member.voice.channelId === queue.dispatcher.channel.id;
        }
        const collector = await channel.createMessageComponentCollector({ filter, time: (track.durationMS - queue.node.getTrackPosition()) });
    
        collector.on('collect', async i => {
            if (!filter) return; 
            logger.log(`${i.member.user.username} pressed ${i.customId}`);
            if (i.customId === "pause") {
                logger.log(queue.node.isPlaying())
                if (!queue.node.isPaused()) {
                    logger.log("paused");
                    await queue.node.pause();
                    // pause collector time
                    await collector.resetTimer({ time: 60000 });
                    player.setTitle(`⏸️ Song Paused`);
                    row.components[0].setLabel("Resume").setEmoji("▶️");
                    await i.update({embed: [player], components: [row]});
                } else {
                        logger.log("resumed");
                        await queue.node.resume();
                        await msg.delete();
                        return await collector.stop();
                }
            } else if (i.customId === "skip") {
                try {
                    const success = queue.node.skip();
                    if (success) {
                        for (let i = 0; i < row.components.length; i++) {
                            row.components[i].setDisabled(true);
                        }
                        await i.update({embed: [player], components: [row]});
                        await msg.delete();
                        await collector.stop();
                    } 
                } catch (e) {
                    logger.error(e);
                }
            } else if (i.customId === "stop") {
                try {
                    await queue.delete();
                    await msg.delete();
                    return await collector.stop();
                } catch (e) {
                    logger.error(e);
                }
            }
        });
    
        collector.on('end', ( collected, reason ) => {
            logger.log(`Collected ${collected.size} interactions. Reason: ${reason}`);
            if (reason === "time") {
                const reply = msg.reply({content: `Are you still there? I'll stop playing music in 30 seconds if you don't respond.`});
                wait(30000).then(() => {
                    if (!queue.node.isPlaying()) {
                        queue.delete();
                        msg.delete();
                        reply.delete();
                    } else {
                        reply.delete();
                    }
                });
            }
        });
    },

};