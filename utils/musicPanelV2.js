// Components V2 rendering of the now-playing panel. Pure: takes state, returns a
// message payload, sends nothing — so it is unit-testable without a voice connection.
//
// A Components V2 message cannot carry embeds or content, so everything the embed
// supplied through setAuthor/setFooter/setTimestamp has to be rendered as text.

const {
  ContainerBuilder, SectionBuilder, TextDisplayBuilder, SeparatorBuilder,
  ThumbnailBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
  escapeMarkdown,
} = require("discord.js");
const PACKAGE_VERSION = require("../package.json").version;
const { progressBar } = require("./musicPlayer");

const ACCENT = 0x5865F2;

// Extractor-supplied metadata is untrusted: a title carrying "](" would retarget
// the link it is interpolated into, and an unbounded one would push the container
// past Discord's 4000-character ceiling.
const MAX_TITLE = 120;
const MAX_AUTHOR = 60;

function isUsableUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function safeText(value, max) {
  const raw = typeof value === "string" ? value : "";
  const flat = raw.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const cut = flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
  return escapeMarkdown(cut).replace(/[[\]]/g, "\\$&");
}

// Parentheses and whitespace terminate a markdown link target early, and
// encodeURIComponent leaves parentheses alone.
function safeUrl(url) {
  if (!isUsableUrl(url)) return null;
  return url.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s/g, "%20");
}

function trackLink(title, url, fallback) {
  const text = safeText(title, MAX_TITLE) || fallback;
  const href = safeUrl(url);
  return href ? `[${text}](${href})` : `**${text}**`;
}

function queueCount(queue) {
  const tracks = queue?.tracks;
  const size = tracks?.size ?? tracks?.data?.length ?? tracks?.length;
  return Number.isInteger(size) && size > 0 ? size : 0;
}

function buildControls(paused, looping = false, { confirmStop = false, pending = 0 } = {}) {
  // Stop abandons a queue anyone in the channel helped build, so the confirm step
  // replaces the whole row: no other control should be one thumb-slip away from it.
  if (confirmStop) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("stop_confirm")
        .setLabel(pending > 0 ? `Kill it (${pending} queued)` : "Kill it")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("💀"),
      new ButtonBuilder()
        .setCustomId("stop_cancel")
        .setLabel("Nah")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("↩️"),
    );
  }

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
    // Success styling is the "on" indicator; the label alone reads ambiguously.
    new ButtonBuilder()
      .setCustomId("loop")
      .setLabel(looping ? "Looping" : "Loop")
      .setStyle(looping ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji("🔁"),
    new ButtonBuilder()
      .setCustomId("stop")
      .setLabel("Stop")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("⏹️"),
  );
}

// Only the ffmpeg filters /filter toggles: the equalizer bands are always on and not a user choice, so listing them would read as a filter nobody enabled.
function activeFilters(queue) {
  try {
    const enabled = queue?.filters?.ffmpeg?.getFiltersEnabled?.();
    if (!Array.isArray(enabled)) return [];
    return enabled.filter(f => typeof f === "string" && f.length > 0);
  } catch (_) {
    return [];
  }
}

function headingFor(queue, paused, looping) {
  const loop = looping ? " 🔁" : "";
  if (paused) return `## ⏸️ Song Paused${loop}`;
  const where = queue?.channel?.name ? ` in ${safeText(queue.channel.name, 60)}` : "";
  return `## 🎧 Now Playing${where}${loop}`;
}

function trackLines(track) {
  const views = track?.views > 0 ? ` | **${track.views.toLocaleString("en-US")}** views` : "";
  const author = safeText(track?.author, MAX_AUTHOR) || "Unknown";
  return `${trackLink(track?.title, track?.url, "Unknown track")}\nBy **${author}**${views}`;
}

// controls:false renders the same panel without buttons, for surfaces with no collector behind them (/np).
function buildNowPlayingV2({ track, queue, requestedBy, client, paused = false, looping = false, controls = true, confirmStop = false }) {
  const container = new ContainerBuilder().setAccentColor(ACCENT);

  const headerText = `${headingFor(queue, paused, looping)}\n${trackLines(track)}`;
  // A section accessory is required; without usable art the section cannot be used.
  if (isUsableUrl(track?.thumbnail)) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(track.thumbnail)),
    );
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
  }

  const bar = progressBar(queue, track);
  if (bar) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(bar));
  }

  const filters = activeFilters(queue);
  if (filters.length > 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`🎛️ **Filters:** ${filters.map(f => `\`${safeText(f, 24)}\``).join(", ")}`),
    );
  }

  const upNext = queue?.tracks?.at?.(0) || null;
  if (upNext) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Up Next:** ${trackLink(upNext.title, upNext.url, "Unknown track")}\nBy **${safeText(upNext.author, MAX_AUTHOR) || "Unknown"}**`,
      ),
    );
  }

  if (controls) {
    const pending = queueCount(queue);
    if (confirmStop) {
      container.addSeparatorComponents(new SeparatorBuilder());
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          pending > 0
            ? `⚠️ **Kill the whole thing?** ${pending} queued track${pending === 1 ? "" : "s"} die with it. There is no undo.`
            : "⚠️ **Kill the whole thing?** There is no undo.",
        ),
      );
    }
    container.addActionRowComponents(buildControls(paused, looping, { confirmStop, pending }));
  }

  // Replaces the embed's author line and footer, which V2 has no equivalent for.
  const credit = [
    requestedBy?.displayName ? `Requested by ${safeText(requestedBy.displayName, 40)}` : null,
    client?.user?.username ? `${safeText(client.user.username, 40)} | Version ${PACKAGE_VERSION}` : null,
  ].filter(Boolean).join(" · ");
  if (credit) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${credit}`));
  }

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

module.exports = { buildNowPlayingV2, buildControls, isUsableUrl, activeFilters, safeText, safeUrl, queueCount, ACCENT };
