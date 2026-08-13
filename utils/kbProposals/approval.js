// Owner approval flow for KB proposals. Sends the bot owner a DM with
// Approve / Edit / Reject buttons. Approving copies the proposal into the live
// knowledge base (utils/kb) and enqueues an embedding job; editing opens a modal
// to tweak the entry before approving; rejecting drops it.
//
// Button customIds carry only the proposal id (kbprop:<action>:<id>) so the
// flow survives a restart — state is reloaded from the durable kb_proposals
// table, not from an in-memory collector.

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle, MessageFlags } = require("discord.js");
const logger = require("../logger");
const kbStore = require("../kb");
const kbPreflight = require("../kb/preflight");
const jobs = require("../jobs");
const store = require("./store");
const { sendDM } = require("../dm");
const { buildInfoEmbed, buildSuccessEmbed, buildErrorEmbed } = require("../embeds");
const { OWNER_ID, EMBED_JOB_MAX_ATTEMPTS } = require("../../config.js");

const SOURCE_LABELS = { tool: "Bot-proposed", auto: "Auto-promoted fact" };

function proposalEmbed(ownerUser, client, proposal) {
  const tags = proposal.tags ? `\n**Tags:** ${proposal.tags}` : "";
  const desc = `**${proposal.title}**\n\n${proposal.content}${tags}`;
  return buildInfoEmbed(ownerUser, client, desc.slice(0, 4000))
    .setTitle("Knowledge Base Suggestion")
    .setFooter({ text: `${SOURCE_LABELS[proposal.source] || proposal.source} • slug: ${proposal.slug} • id ${proposal.id}` });
}

function buttonRow(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`kbprop:approve:${id}`).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`kbprop:edit:${id}`).setLabel("Edit").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`kbprop:reject:${id}`).setLabel("Reject").setStyle(ButtonStyle.Danger),
  );
}

// DM the owner with the pending proposal. Returns true if the DM was sent.
async function notifyOwnerOfProposal(client, proposal) {
  try {
    const owner = await client.users.fetch(OWNER_ID);
    if (!owner) {
      logger.warn("[KBProposals] Could not fetch owner to notify.");
      return false;
    }
    const sent = await sendDM(owner, {
      embeds: [proposalEmbed(owner, client, proposal)],
      components: [buttonRow(proposal.id)],
    });
    return !!sent;
  } catch (err) {
    logger.error(`[KBProposals] Failed to notify owner: ${err.message}`);
    return false;
  }
}

// Pick a kb slug that does not collide with an existing live entry by appending
// a numeric suffix. The base slug already satisfies the kb slug format.
function uniqueSlug(guildId, baseSlug) {
  let slug = baseSlug;
  let n = 2;
  while (kbStore.getBySlug(guildId, slug)) {
    const suffix = `-${n}`;
    slug = `${baseSlug.slice(0, 64 - suffix.length)}${suffix}`;
    n += 1;
  }
  return slug;
}

// Copy a proposal into the live knowledge base and enqueue its embedding.
async function promoteToKb(proposal, resolvedBy) {
  const slug = uniqueSlug(proposal.guildId, proposal.slug);
  await kbStore.create({
    guildId: proposal.guildId,
    slug,
    title: proposal.title.slice(0, 100),
    content: proposal.content.slice(0, 4000),
    tags: proposal.tags || null,
    creatorId: resolvedBy,
  });
  kbPreflight.invalidate(proposal.guildId);
  try {
    jobs.enqueue({ kind: "kb_embed", payload: { guildId: proposal.guildId, slug }, run_at: Date.now(), max_attempts: EMBED_JOB_MAX_ATTEMPTS });
  } catch (err) {
    logger.error(`[KBProposals] Failed to enqueue kb_embed for "${slug}": ${err.message}`);
  }
  return slug;
}

function editModal(proposal) {
  return new ModalBuilder()
    .setCustomId(`kbpropedit:${proposal.id}`)
    .setTitle("Edit KB Entry")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("title").setLabel("Title").setStyle(TextInputStyle.Short)
          .setMaxLength(100).setValue(proposal.title.slice(0, 100)).setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("content").setLabel("Content").setStyle(TextInputStyle.Paragraph)
          .setMaxLength(4000).setValue(proposal.content.slice(0, 4000)).setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("tags").setLabel("Tags (comma-separated, optional)").setStyle(TextInputStyle.Short)
          .setMaxLength(200).setValue(proposal.tags || "").setRequired(false),
      ),
    );
}

async function finishApproval(interaction, client, proposal, resolvedBy) {
  // Flip the status first: setStatus is an atomic pending->approved guard, so a
  // double-click or two raced buttons can't both reach promoteToKb and create
  // duplicate live KB entries (foo and foo-2) from a single proposal.
  if (!store.setStatus(proposal.id, "approved", resolvedBy)) {
    return interaction.update({
      embeds: [buildInfoEmbed(interaction.user, client, "This suggestion has already been handled.").setTitle("Already Resolved")],
      components: [],
    }).catch(() => {});
  }
  const slug = await promoteToKb(proposal, resolvedBy);
  logger.log(`[KBProposals] Approved proposal ${proposal.id} -> kb "${slug}" (${proposal.guildId})`);
  const owner = interaction.user;
  await interaction.update({
    embeds: [buildSuccessEmbed(owner, client, `**${proposal.title}** added to the knowledge base as \`${slug}\`.`)
      .setTitle("Knowledge Base Entry Added")],
    components: [],
  });
}

// Route a kbprop:* button (and its edit modal) from the owner DM. The caller in
// bot.js guarantees interaction.customId starts with "kbprop:".
async function handleProposalInteraction(interaction, client) {
  if (interaction.user.id !== OWNER_ID) {
    return interaction.reply({ content: "This action is for the bot owner only.", flags: MessageFlags.Ephemeral });
  }

  const [, action, idStr] = interaction.customId.split(":");
  const id = parseInt(idStr, 10);
  const proposal = store.getById(id);

  if (!proposal || proposal.status !== "pending") {
    return interaction.update({
      embeds: [buildInfoEmbed(interaction.user, client, "This suggestion has already been handled.").setTitle("Already Resolved")],
      components: [],
    }).catch(() => {});
  }

  try {
    if (action === "reject") {
      store.setStatus(id, "rejected", interaction.user.id);
      logger.log(`[KBProposals] Rejected proposal ${id}`);
      return interaction.update({
        embeds: [buildErrorEmbed(interaction.user, client, `Rejected **${proposal.title}**. Nothing was added.`).setTitle("Suggestion Rejected")],
        components: [],
      });
    }

    if (action === "approve") {
      return finishApproval(interaction, client, proposal, interaction.user.id);
    }

    if (action === "edit") {
      await interaction.showModal(editModal(proposal));
      // Track that a collector is awaiting this modal so bot.js can tell an
      // in-flight submit (let the collector handle it) from a late/orphan one
      // (ack it there to avoid Discord's "This interaction failed").
      const modalId = `kbpropedit:${id}`;
      const pending = (client.pendingKbEdits ||= new Set());
      pending.add(modalId);
      let submitted;
      try {
        submitted = await interaction.awaitModalSubmit({
          time: 5 * 60 * 1000,
          filter: i => i.customId === modalId && i.user.id === interaction.user.id,
        });
      } catch (_) {
        // Modal timed out — leave the original buttons live for a later decision.
        return;
      } finally {
        pending.delete(modalId);
      }
      const title = submitted.fields.getTextInputValue("title").trim();
      const content = submitted.fields.getTextInputValue("content").trim();
      const tags = submitted.fields.getTextInputValue("tags").trim() || null;
      const updated = store.update(id, { title, content, tags }) || proposal;
      return finishApproval(submitted, client, updated, interaction.user.id);
    }

    return interaction.reply({ content: "Unknown action.", flags: MessageFlags.Ephemeral });
  } catch (err) {
    logger.error(`[KBProposals] Interaction handler failed for ${interaction.customId}: ${err.message}`);
    if (!interaction.replied && !interaction.deferred) {
      return interaction.reply({ content: "Something went wrong handling that.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

module.exports = { notifyOwnerOfProposal, handleProposalInteraction, uniqueSlug };
