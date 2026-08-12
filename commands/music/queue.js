const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const wait = require("util").promisify(setTimeout);
const { queueString } = require("../../utils/musicFormat");
const logger = require("../../utils/logger");
const { buildInfoEmbed } = require("../../utils/embeds");
const { resolveMusicContext } = require("../../utils/musicGuards");

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
        .setName("shuffle")
        .setDescription("Shuffle the queue.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("view")
        .setDescription("View the queue.")
    ),
  async execute(interaction) {
    const embed = buildInfoEmbed(interaction.user, interaction.client);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { queue, failed } = await resolveMusicContext(interaction, { requireTrack: false });
    if (failed) return;

    const tracks = queue.tracks;
    const subcommand = interaction.options.getSubcommand();
    switch (subcommand) {
      case "clear":
        embed.setTitle("Are you sure you want to clear the queue?");
        embed.setDescription("This will clear the queue and stop the current song. You can cancel this by clicking the cancel button.");
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId("clearQueue")
              .setLabel("Clear Queue")
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId("cancel")
              .setLabel("Cancel")
              .setStyle(ButtonStyle.Secondary),
          );
        await interaction.editReply({embeds: [embed], components: [row]});
        const filter = (i) => i.customId === "clearQueue" || i.customId === "cancel";
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 30000 });
        collector.on("collect", async (i) => {
          if (i.customId === "clearQueue") {
            queue.node.stop();
            tracks.clear();
            embed.setTitle("Queue has been cleared!");
            embed.setDescription("The queue has been cleared and the current song has been stopped.");
            await i.update({embeds: [embed], components: []});
            await wait(30000).then(() => i.deleteReply());
          } else if (i.customId === "cancel") {
            embed.setTitle("Queue clear cancelled!");
            embed.setDescription("The queue clear has been cancelled.");
            await i.update({embeds: [embed], components: []});
            await wait(30000).then(() => i.deleteReply());
          }
        });
        collector.on("end", async (collected, reason) => {
          logger.debug(`Clear command collector has ended. Collected ${collected.size} items, reason: ${reason}`);
          if (reason === "time") {
            embed.setTitle("Queue clear timed out!");
            embed.setDescription("The queue clear has timed out.");
            await interaction.editReply({embeds: [embed], components: []});
            await wait(30000).then(() => interaction.deleteReply());
          }
        });
        break;

      case "shuffle":
        embed.setTitle("Are you sure you want to shuffle the queue?");
        embed.setDescription("This will shuffle all the songs in the queue. You can cancel this by clicking the cancel button.");
        const row2 = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId("shuffleQueue")
              .setLabel("Shuffle Queue")
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId("cancel")
              .setLabel("Cancel")
              .setStyle(ButtonStyle.Secondary),
          );
        await interaction.editReply({embeds: [embed], components: [row2]});
        const filter2 = (i) => i.customId === "shuffleQueue" || i.customId === "cancel";
        const collector2 = interaction.channel.createMessageComponentCollector({ filter: filter2, time: 30000 });
        collector2.on("collect", async (i) => {
          if (i.customId === "shuffleQueue") {
            tracks.shuffle();
            interaction.deleteReply();

            embed.setAuthor({ name: `${interaction.user.displayName } has shuffled the queue!`, iconURL: interaction.user.displayAvatarURL({dynamic: true}) });
            embed.setTitle("New queue:");
            embed.setDescription(`${queueString(tracks)}`);
            const msg = await interaction.channel.send({embeds: [embed]});
            collector2.stop();
            await wait(30000).then(() => {
              msg.delete();
            });
          } else if (i.customId === "cancel") {
            embed.setTitle("Request cancelled!");
            embed.setDescription("The request to shuffle the queue has been cancelled.");
            await i.update({embeds: [embed], components: []});
            await wait(30000).then(() => i.deleteReply());
          }
        });
        collector2.on("end", async (collected, reason) => {
          logger.debug(`Shuffle command collector has ended. Collected ${collected.size} items, reason: ${reason}`);
          if (reason === "time") {
            embed.setTitle("Request timed out!");
            embed.setDescription("The request to shuffle the queue has timed out.");
            await interaction.editReply({embeds: [embed], components: []});
            collector2.stop();
            await wait(30000).then(() => interaction.deleteReply());
          }
        });
        break;

      case "view":
        embed.setTitle("Current queue:");
        embed.setDescription(`${queueString(tracks)}`);
        await interaction.editReply({embeds: [embed]});
        await wait(30000).then(() => interaction.deleteReply());
        break;
      default: "view";
    }
  }
};
