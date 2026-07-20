const logger = require("../logger");
const kbStore = require("../kb");
const store = require("./store");
const { notifyOwnerOfProposal, handleProposalInteraction, uniqueSlug } = require("./approval");

// Facts whose key carries one of these prefixes are evergreen, server-scoped
// knowledge worth offering as a KB entry rather than a transient channel fact.
const EVERGREEN_KEY_RE = /^(server|lore|rule|event)[._]/i;

function humanizeKey(key) {
  return key
    .replace(/[._]+/g, " ")
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

// Raise an owner suggestion for the first high-confidence, server-scoped channel
// fact in a batch. Deliberately at most one per call so a chatty channel can't
// spam the owner; the store's dedup hash suppresses repeats across calls.
async function maybeProposeFromFacts({ client, guildId, facts, originUserId }) {
  if (!client || !guildId || !Array.isArray(facts) || facts.length === 0) return;

  const candidate = facts.find(f =>
    f && f.key && f.confidence === "high" && EVERGREEN_KEY_RE.test(f.key) &&
    typeof f.value === "string" && f.value.trim().length >= 2);
  if (!candidate) return;

  const title = humanizeKey(candidate.key);
  const content = candidate.value.trim();

  // Don't suggest something the KB already documents under the same slug.
  if (kbStore.getBySlug(guildId, store.slugify(title))) return;

  try {
    const proposal = store.create({ guildId, title, content, source: "auto", originUserId });
    if (!proposal) return;
    if (!(await notifyOwnerOfProposal(client, proposal))) {
      // DM delivery failed — drop the row so it isn't stranded pending with no
      // approval path, and its dedup_hash doesn't block re-proposing this later.
      store.remove(proposal.id);
      logger.warn(`[KBProposals] Dropped auto-promote suggestion ${proposal.id}: owner notification failed.`);
      return;
    }
    logger.log(`[KBProposals] Auto-promote suggestion ${proposal.id} for "${candidate.key}" in guild ${guildId}`);
  } catch (err) {
    logger.error(`[KBProposals] maybeProposeFromFacts failed: ${err.message}`);
  }
}

module.exports = {
  store,
  create: store.create,
  getById: store.getById,
  notifyOwnerOfProposal,
  handleProposalInteraction,
  maybeProposeFromFacts,
  uniqueSlug,
};
