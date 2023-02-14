const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder } = require('discord.js');
const wait = require('util').promisify(setTimeout);
const logger = require('../../utils/logger');
const { queueString } = require('../../utils/musicPlayer');

module.exports = {
    data: new SlashCommandBuilder()
        .setName("queue")
        .setDescription("Various queue commands.")
        .addSubcommand((subcommand) =>
            subcommand
                .setName("clear")
                .setDescription("Clear the queue.")
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("loop")
                .setDescription("Toggle queue looping.")
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("shuffle")
                .setDescription("Shuffle the queue.")
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("view")
                .setDescription("View the queue.")
        ),
    async execute(interaction) {
        const player = interaction.client.player;
        const embed = new EmbedBuilder()
        .setColor(0x00AE86)
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
        const queue = player.nodes.get(interaction.guild)
        if (!queue) {
            embed.setTitle("No queue found!");
            embed.setDescription("There is no queue to use this command on.");
            return await interaction.editReply({embeds: [embed], ephemeral: true});
        }
        const tracks = queue.tracks; 
        const subcommand = interaction.options.getSubcommand();
        switch (subcommand) {
            case "clear":
                queue.node.clear();
                embed.setTitle("Queue cleared!");
                embed.setDescription(`The queue has been cleared!`);
                await interaction.editReply({embeds: [embed], ephemeral: true});
                break;
            case "loop":
                queue.node.setRepeatMode(queue.repeatMode ? 0 : 1);
                embed.setTitle(`Queue is ${queue.repeatMode ? "now" : "no longer"} looping!`);
                embed.setDescription(`Song looping has been ${queue.repeatMode ? "enabled" : "disabled"}! You can ${queue.repeatMode ? "disable" : "enable"} it by using this command again.`);
                await interaction.editReply({embeds: [embed], ephemeral: true});
                break;
            case "shuffle":
                tracks.shuffle();
                const result = queueString(tracks);
                embed.setAuthor({ name: `${interaction.guild.name} has shuffled the queue!`, iconURL: interaction.guild.iconURL({dynamic: true}) });
                embed.setTitle(`New queue:`)
                embed.setDescription(`${result}`);
                await interaction.editReply({embeds: [embed]});
                await wait(10000).then(() => interaction.deleteReply());
                break;
            case "view":
                embed.setTitle(`Queue for ${interaction.guild.name}`);
                //embed.setDescription(`Currently playing: [${currentTrack.title}](${currentTrack.url})`);
                embed.addFields(
                    { name: "Up Next", value: tracks.map((track, i) => `${i + 1}. [${track.title}](${track.url})`).join("\n") || "No songs in queue." },
                )
                await interaction.editReply({embeds: [embed], ephemeral: true});
                break;
            default: "view";
        }
    }
}
