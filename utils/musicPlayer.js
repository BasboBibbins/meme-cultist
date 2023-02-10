const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const wait = require("util").promisify(setTimeout);

module.exports = {
    trackStart: async (client, queue, track) => {
        //console.log(queue)
        //console.log(track)
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
        const player = new EmbedBuilder()
        .setTitle(`▶️ Now Playing ${queue.dispatcher.channel.name ? `in ${queue.dispatcher.channel.name}` : ""}`)
        .setAuthor({ name: `Requested by ${requestedBy.username}`, iconURL: requestedBy.displayAvatarURL({dynamic: true}) })
        .setDescription(`[${track.title}](${track.url})\nBy **${track.author}** | **${track.views}** views | **${track.duration}**`)
        .setThumbnail(track.thumbnail)
        .setColor(0x00AE86)
        .setFooter({ text: `Meme Cultist | Version ${require('../package.json').version}`, iconURL: client.user.displayAvatarURL({dynamic: true}) })
        .setTimestamp();

        await channel.send({embeds: [player], components: [row]});


        const filter = i => {
            console.log(`${i.member.voice.channelId} === ${queue.dispatcher.channel.id} = ${i.member.voice.channelId === queue.dispatcher.channel.id}`)
            return i.member.voice.channelId === queue.dispatcher.channel.id;
        }
        const collector = await channel.createMessageComponentCollector({ filter, time: time });
    
        collector.on('collect', async i => {
            if (!filter) return; 
            if (!i.isButton()) return;
            await wait(1000);
            console.log(`${i.member.user.username} pressed ${i.customId}`);
            if (i.customId === "pause") {
                console.log(queue.node.isPlaying())
                if (queue.node.isPlaying()) {
                    console.log("paused");
                    await queue.node.pause();
                    player.setTitle(`⏸️ Song Paused`);
                    row.components[0].setLabel("Resume").setEmoji("▶️");
                    await i.update({embed: [player], components: [row]});
                } else {
                    console.log("resumed");
                    await queue.node.resume();
                    player.setTitle(`▶️ Song Resumed`);
                    row.components[0].setLabel("Pause").setEmoji("⏸️");
                    await i.update({embed: [player], components: [row]});
                }
            } else if (i.customId === "skip") {
                const success = queue.skip();
                if (success) {
                    for (let i = 0; i < row.components.length; i++) {
                        row.components[i].setDisabled(true);
                    }
                    await i.update({embed: [player], components: [row]});
                    await collector.stop();
                }
            } else if (i.customId === "stop") {
                queue.destroy();
                for (let i = 0; i < row.components.length; i++) {
                    row.components[i].setDisabled(true);
                }
                await i.update({embed: [player], components: [row]});
                await collector.stop();
            }
        });
    
        collector.on('end', ( collected, reason ) => {
            console.log(`Collected ${collected.size} interactions. Reason: ${reason}`);
        });
    }
};