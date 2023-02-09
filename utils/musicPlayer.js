const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");

module.exports = {
    trackStart: async (client, queue, track) => {
        console.log(queue)
        console.log(track)
        const time = track.duration.split(":").reverse().reduce((prev, curr, i) => prev + curr * Math.pow(60, i), 0) * 1000;    
        const channel = queue.options.metadata.channel;
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
        const embed = new EmbedBuilder()
        .setTitle(`▶️ Now Playing in ${channel.name}`)
        .setAuthor({ name: `Requested by ${requestedBy.username}`, iconURL: track.requestedBy.displayAvatarURL({dynamic: true}) })
        .setDescription(`[${track.title}](${track.url})\nBy **${track.author}** | **${track.duration}** | **${track.views}** views`)
        .setThumbnail(track.thumbnail)
        .setColor(0x00AE86)
        .setFooter({ text: `Meme Cultist | Version ${require('../package.json').version}`, iconURL: client.user.displayAvatarURL({dynamic: true}) })
        .setTimestamp();

        await channel.send({embeds: [embed], components: [row]});


        const filter = i => i.member.voice.channelId === queue.options.metadata.channel.id;
        const collector = channel.createMessageComponentCollector({ filter, time: time });
    
        collector.on('collect', async i => {
            if (!filter) return; 
            console.log(`${i.member.user.username} pressed ${i.customId}`);
            if (i.customId === "pause") {
                console.log(queue.playing)
                if (queue.playing) {
                    console.log("paused");
                    queue.setPaused(true);
                    queue.playing = false;
                    embed.setTitle(`⏸️ Song Paused`);
                    row.components[0].setLabel("Resume").setEmoji("▶️");
                    i.update({embed: [embed], components: [row]});
                } else {
                    console.log("resumed");
                    queue.setPaused(false);
                    queue.playing = true;
                    embed.setTitle(`▶️ Song Resumed`);
                    row.components[0].setLabel("Pause").setEmoji("⏸️");
                    i.update({embed: [embed], components: [row]});
                }
            } else if (i.customId === "skip") {
                const success = queue.skip();
                if (success) {
                    for (let i = 0; i < row.components.length; i++) {
                        row.components[i].setDisabled(true);
                    }
                    i.update({embed: [embed], components: [row]});
                    await collector.stop();
                }
            } else if (i.customId === "stop") {
                queue.destroy();
                for (let i = 0; i < row.components.length; i++) {
                    row.components[i].setDisabled(true);
                }
                i.update({embed: [embed], components: [row]});
                await collector.stop();
            }
        });
    
        collector.on('end', ( collected, reason ) => {
            console.log(`Collected ${collected.size} interactions. Reason: ${reason}`);
        });
    },
    trackEnd: async (client, queue, track) => {
        const lastMessageId = await channel.lastMessageId;
        const lastMessage = await channel.channel.messages.fetch(lastMessageId);
        lastMessage.delete();
    },
};