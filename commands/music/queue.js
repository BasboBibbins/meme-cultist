const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const logger = require("../../utils/logger");
const { queuePage, formatClock, trackArray } = require("../../utils/music/format");
const { musicEmbed, musicErrorEmbed } = require("../../utils/music/embeds");
const { resolveMusicContext } = require("../../utils/music/guards");
const { autoDismiss } = require("../../utils/music/dismiss");

const CONFIRM_TIMEOUT_MS = 30000;
const VIEW_TIMEOUT_MS = 120000;
const DISMISS_MS = 15000;

// Every customId carries the invocation id. Sharing bare ids across two subcommands
// meant one /queue cancel button answered the other invocation's collector.
const id = (interaction, name) => `queue:${name}:${interaction.id}`;

function confirmRow(interaction, action, label, style) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(id(interaction, action)).setLabel(label).setStyle(style),
    new ButtonBuilder().setCustomId(id(interaction, "cancel")).setLabel("Nah").setStyle(ButtonStyle.Secondary),
  );
}

function pageRow(interaction, page, pages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(id(interaction, "prev")).setLabel("Back").setStyle(ButtonStyle.Secondary).setEmoji("⬅️").setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(id(interaction, "next")).setLabel("More").setStyle(ButtonStyle.Secondary).setEmoji("➡️").setDisabled(page >= pages),
  );
}

// The base footer carries the bot name and version, so the page counter is appended to it rather than replacing it.
function renderPage(embed, queue, page, baseFooter) {
  const { text, page: current, pages, total, durationMs } = queuePage(queue.tracks, page);
  const runtime = durationMs > 0 ? ` · ${formatClock(durationMs)} of it` : "";
  embed.setTitle(total > 0 ? `Queue (${total} track${total === 1 ? "" : "s"}${runtime})` : "Queue")
    .setDescription(text)
    .setFooter({ text: pages > 1 ? `${baseFooter.text} | Page ${current} of ${pages}` : baseFooter.text, iconURL: baseFooter.iconURL });
  return { current, pages };
}

// A confirmation is the requester's to answer. Anyone else pressing it gets told so
// rather than silently wiping a queue the whole channel helped build.
function ownerOnly(interaction) {
  return async i => {
    if (i.user.id === interaction.user.id) return true;
    await i.reply({
      embeds: [musicErrorEmbed(interaction, "Not your prompt. Run the command yourself.")],
      flags: MessageFlags.Ephemeral,
    }).catch(err => logger.debug(`[Queue] Could not reject a foreign press: ${err.message}`));
    return false;
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Various queue commands.")
    .addSubcommand(sub => sub.setName("view").setDescription("View the queue."))
    .addSubcommand(sub => sub.setName("shuffle").setDescription("Shuffle the queue."))
    .addSubcommand(sub => sub.setName("clear").setDescription("Clear the queue and stop the current song."))
    .addSubcommand(sub => sub
      .setName("remove")
      .setDescription("Remove one track from the queue.")
      .addIntegerOption(option => option
        .setName("position")
        .setDescription("Its number in /queue view.")
        .setMinValue(1)
        .setRequired(true))),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { queue, failed } = await resolveMusicContext(interaction, { requireTrack: false });
    if (failed) return;

    const embed = await musicEmbed(interaction);
    const subcommand = interaction.options.getSubcommand();
    const gate = ownerOnly(interaction);

    if (subcommand === "view") {
      let page = 1;
      const baseFooter = { text: embed.data.footer?.text ?? "", iconURL: embed.data.footer?.icon_url };
      const { pages } = renderPage(embed, queue, page, baseFooter);
      const reply = await interaction.editReply({
        embeds: [embed],
        components: pages > 1 ? [pageRow(interaction, page, pages)] : [],
      });

      if (pages <= 1) return autoDismiss(interaction, VIEW_TIMEOUT_MS);

      const collector = reply.createMessageComponentCollector({
        filter: i => i.customId.startsWith("queue:") && i.customId.endsWith(interaction.id),
        time: VIEW_TIMEOUT_MS,
      });

      collector.on("collect", async i => {
        if (!await gate(i)) return;
        page += i.customId.startsWith("queue:next:") ? 1 : -1;
        const state = renderPage(embed, queue, page, baseFooter);
        page = state.current;
        await i.update({ embeds: [embed], components: [pageRow(interaction, state.current, state.pages)] })
          .catch(err => logger.debug(`[Queue] Page turn failed: ${err.message}`));
      });

      collector.on("end", () => autoDismiss(interaction, 0));
      return;
    }

    if (subcommand === "remove") {
      const position = interaction.options.getInteger("position");
      const tracks = trackArray(queue.tracks);
      const target = tracks[position - 1];

      if (!target) {
        return interaction.editReply({
          embeds: [musicErrorEmbed(interaction, tracks.length
            ? `There is no track ${position}. The queue stops at ${tracks.length}.`
            : "The queue is empty. Nothing to pull out of it.")],
        });
      }

      queue.node.remove(target);
      embed.setTitle("Removed").setDescription(`Dropped **${target.title}** from slot ${position}. ${tracks.length - 1} left.`);
      await interaction.editReply({ embeds: [embed] });
      return autoDismiss(interaction, DISMISS_MS);
    }

    const pending = trackArray(queue.tracks).length;

    if (subcommand === "shuffle") {
      if (pending < 2) {
        return interaction.editReply({
          embeds: [musicErrorEmbed(interaction, `Shuffling ${pending} track${pending === 1 ? "" : "s"} would accomplish nothing.`)],
        });
      }

      // Primary, not Danger: shuffling is reversible in the only sense that matters, and reserving Danger for the wipe keeps that signal worth something.
      embed.setTitle("Shuffle the queue?").setDescription(`${pending} tracks get reordered. The current song keeps playing.`);
      const reply = await interaction.editReply({ embeds: [embed], components: [confirmRow(interaction, "shuffle", "Shuffle", ButtonStyle.Primary)] });

      const collector = reply.createMessageComponentCollector({
        filter: i => i.customId.endsWith(interaction.id),
        time: CONFIRM_TIMEOUT_MS,
        max: 1,
      });

      collector.on("collect", async i => {
        if (!await gate(i)) return;
        if (i.customId.startsWith("queue:cancel:")) {
          embed.setTitle("Left alone").setDescription("Queue order untouched.");
        } else {
          queue.tracks.shuffle();
          embed.setTitle("Shuffled").setDescription(`${pending} tracks reordered.`);
          // Announced publicly because it changes what everyone else is waiting for.
          await interaction.channel.send({
            embeds: [(await musicEmbed(interaction, `🔀 **${interaction.user.displayName}** shuffled the queue. ${pending} tracks reordered.`)).setTitle(null)],
          }).catch(err => logger.debug(`[Queue] Could not announce the shuffle: ${err.message}`));
        }
        await i.update({ embeds: [embed], components: [] }).catch(err => logger.debug(`[Queue] Shuffle update failed: ${err.message}`));
      });

      collector.on("end", async (collected, reason) => {
        if (reason === "time" && collected.size === 0) {
          embed.setTitle("Timed out").setDescription("Nothing was shuffled.");
          await interaction.editReply({ embeds: [embed], components: [] }).catch(() => {});
        }
        autoDismiss(interaction, DISMISS_MS);
      });
      return;
    }

    // clear
    embed.setTitle("Kill the whole queue?")
      .setDescription(pending > 0
        ? `This stops the current song **and** drops ${pending} queued track${pending === 1 ? "" : "s"}. There is no undo.`
        : "This stops the current song. There is no undo.");

    const reply = await interaction.editReply({ embeds: [embed], components: [confirmRow(interaction, "clear", pending > 0 ? `Kill it (${pending} queued)` : "Kill it", ButtonStyle.Danger)] });

    const collector = reply.createMessageComponentCollector({
      filter: i => i.customId.endsWith(interaction.id),
      time: CONFIRM_TIMEOUT_MS,
      max: 1,
    });

    collector.on("collect", async i => {
      if (!await gate(i)) return;
      if (i.customId.startsWith("queue:cancel:")) {
        embed.setTitle("Spared").setDescription("Queue left where it was.");
      } else {
        queue.tracks.clear();
        queue.node.stop();
        embed.setTitle("Wiped").setDescription("Queue cleared and playback stopped.");
      }
      await i.update({ embeds: [embed], components: [] }).catch(err => logger.debug(`[Queue] Clear update failed: ${err.message}`));
    });

    collector.on("end", async (collected, reason) => {
      if (reason === "time" && collected.size === 0) {
        embed.setTitle("Timed out").setDescription("Queue left where it was.");
        await interaction.editReply({ embeds: [embed], components: [] }).catch(() => {});
      }
      autoDismiss(interaction, DISMISS_MS);
    });
  },
};
