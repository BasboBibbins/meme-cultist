// Components V2 rendering of the now-playing panel. Pure: takes state, returns a
// message payload, sends nothing — so it is unit-testable without a voice connection.
//
// A Components V2 message cannot carry embeds or content, so everything the embed
// supplied through setAuthor/setFooter/setTimestamp has to be rendered as text.

const {
  ContainerBuilder, SectionBuilder, TextDisplayBuilder, SeparatorBuilder,
  ThumbnailBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require("discord.js");
const PACKAGE_VERSION = require("../package.json").version;
const { progressBar } = require("./musicPlayer");

const ACCENT = 0x5865F2;

function isUsableUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function buildControls(paused) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("pause")
      .setLabel(paused ? "Resume" : "Pause")
      .setStyle(ButtonStyle.Primary)
      .setEmoji(paused ? "▶️" : "⏸️"),
    new ButtonBuilder()
      .setCustomId("skip")
      .setLabel("Skip")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⏭️")
      .setDisabled(paused),
    new ButtonBuilder()
      .setCustomId("stop")
      .setLabel("Stop")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("⏹️"),
  );
}

function headingFor(queue, paused) {
  if (paused) return "## ⏸️ Song Paused";
  const where = queue?.channel?.name ? ` in ${queue.channel.name}` : "";
  return `## 🎧 Now Playing${where}`;
}

function trackLines(track) {
  const views = track?.views > 0 ? ` | **${track.views.toLocaleString("en-US")}** views` : "";
  return `[${track?.title ?? "Unknown track"}](${track?.url ?? ""})\nBy **${track?.author ?? "Unknown"}**${views}`;
}

function buildNowPlayingV2({ track, queue, requestedBy, client, paused = false }) {
  const container = new ContainerBuilder().setAccentColor(ACCENT);

  const header = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${headingFor(queue, paused)}\n${trackLines(track)}`),
    );
  // A section accessory is required; without usable art the section cannot be used.
  if (isUsableUrl(track?.thumbnail)) {
    header.setThumbnailAccessory(new ThumbnailBuilder().setURL(track.thumbnail));
    container.addSectionComponents(header);
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${headingFor(queue, paused)}\n${trackLines(track)}`),
    );
  }

  const bar = progressBar(queue, track);
  if (bar) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(bar));
  }

  const upNext = queue?.tracks?.at?.(0) || null;
  if (upNext) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**Up Next:** [${upNext.title}](${upNext.url})\nBy **${upNext.author}**`),
    );
  }

  container.addActionRowComponents(buildControls(paused));

  // Replaces the embed's author line and footer, which V2 has no equivalent for.
  const credit = [
    requestedBy?.displayName ? `Requested by ${requestedBy.displayName}` : null,
    client?.user?.username ? `${client.user.username} | Version ${PACKAGE_VERSION}` : null,
  ].filter(Boolean).join(" · ");
  if (credit) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${credit}`));
  }

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

module.exports = { buildNowPlayingV2, buildControls, isUsableUrl, ACCENT };
