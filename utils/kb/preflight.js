// Deterministic knowledge-base pre-flight. lookup_kb is a tool the model has to
// choose to call, which it rarely does on an ambient conversational turn — so
// curated entries only ever surfaced when someone asked outright. This scores
// each inbound turn against the KB locally and injects the best matches into
// the prompt before the first LLM call.
//
// Lexical only: an embedding call per inbound message would add a network
// round-trip to every single chatbot turn, which the Pi 3 budget does not allow.
// Title and tag hits are weighted above body hits, and tokens that appear in
// most entries are discounted so generic words ("koku", "bot") don't match
// everything.

const store = require("./store");
const logger = require("../logger");
const { tokenize: sharedTokenize, RETRIEVAL_STOPWORDS } = require("../text");
const {
  KB_PREFLIGHT_MIN_SCORE,
  KB_PREFLIGHT_MAX_ENTRIES,
  KB_PREFLIGHT_CONTENT_CHARS,
} = require("../../config");

const INDEX_TTL_MS = 10 * 60 * 1000;

// Two-character tokens match far too many entries to be useful signal here,
// so KB matching is stricter than fact/directive matching.
const MIN_TOKEN_LENGTH = 3;

const _index = new Map();

function tokenize(text) {
  return sharedTokenize(text, MIN_TOKEN_LENGTH, RETRIEVAL_STOPWORDS);
}

function buildIndex(guildId) {
  const entries = store.listForGuild(guildId) || [];
  const docs = entries.map(e => ({
    slug: e.slug,
    title: e.title,
    content: e.content,
    titleTokens: new Set(tokenize(e.title).concat(tokenize(e.slug))),
    tagTokens: new Set(tokenize(e.tags)),
    contentTokens: new Set(tokenize(e.content)),
  }));

  const docFreq = new Map();
  for (const doc of docs) {
    const all = new Set([...doc.titleTokens, ...doc.tagTokens, ...doc.contentTokens]);
    for (const t of all) docFreq.set(t, (docFreq.get(t) || 0) + 1);
  }

  const index = { docs, docFreq, builtAt: Date.now() };
  _index.set(guildId, index);
  logger.debug(`[KBPreflight] Built index for guild ${guildId}: ${docs.length} entries, ${docFreq.size} terms`);
  return index;
}

function getIndex(guildId) {
  const cached = _index.get(guildId);
  if (cached && Date.now() - cached.builtAt < INDEX_TTL_MS) return cached;
  return buildIndex(guildId);
}

function invalidate(guildId) {
  if (guildId) _index.delete(guildId);
  else _index.clear();
}

// Rare terms carry the match. Without this a query mentioning "koku" would tie
// against every economy entry at once.
function idf(docFreq, totalDocs, token) {
  const df = docFreq.get(token) || 0;
  if (df === 0) return 0;
  return Math.log((totalDocs + 1) / (df + 0.5));
}

// How many query terms a document is scored against. Normalizing over EVERY
// term would let unrelated words dilute the score, so a topic mentioned inside
// a long message would silently stop matching — the denominator has to depend
// on how strong the match is, not on how much the user typed.
const SCORED_TERMS = 4;

function scoreDocs(index, queryTokens) {
  const total = index.docs.length;
  if (total === 0 || queryTokens.length === 0) return [];

  const unique = [...new Set(queryTokens)];
  const weights = new Map();
  for (const t of unique) {
    const w = idf(index.docFreq, total, t);
    if (w > 0) weights.set(t, w);
  }
  if (weights.size === 0) return [];

  // Ceiling: the best a document could do is a title hit on the k rarest terms.
  const bestTerms = [...weights.values()].sort((a, b) => b - a).slice(0, SCORED_TERMS);
  const maxPossible = bestTerms.reduce((sum, w) => sum + w * 3, 0);
  if (maxPossible <= 0) return [];

  return index.docs.map(doc => {
    const hits = [];
    for (const [t, weight] of weights) {
      if (doc.titleTokens.has(t)) hits.push(weight * 3);
      else if (doc.tagTokens.has(t)) hits.push(weight * 2);
      else if (doc.contentTokens.has(t)) hits.push(weight);
    }
    hits.sort((a, b) => b - a);
    const raw = hits.slice(0, SCORED_TERMS).reduce((sum, w) => sum + w, 0);
    return { doc, score: Math.min(1, raw / maxPossible) };
  }).sort((a, b) => b.score - a.score);
}

// Returns [{ slug, title, content, score }] above the configured threshold.
//
// `minScore` is overridable because the default is tuned for *ambient* injection
// — it has to be strict enough that unrelated chatter doesn't pull KB entries
// into every turn. An explicit lookup is the opposite situation: someone asked
// outright, so a weak match beats returning nothing.
function findRelevant(guildId, text, limit = KB_PREFLIGHT_MAX_ENTRIES, minScore = KB_PREFLIGHT_MIN_SCORE) {
  if (!guildId || !text) return [];
  try {
    const index = getIndex(guildId);
    const scored = scoreDocs(index, tokenize(text));
    return scored
      .filter(s => s.score >= (minScore ?? 0.25))
      .slice(0, limit)
      .map(s => ({
        slug: s.doc.slug,
        title: s.doc.title,
        content: s.doc.content,
        score: s.score,
      }));
  } catch (err) {
    logger.warn(`[KBPreflight] Lookup failed for guild ${guildId}: ${err.message}`);
    return [];
  }
}

// The only KB path that truncates, because it is the only one that pays per turn.
function clip(content, cap) {
  if (typeof content !== "string" || content.length <= cap) return content;
  const head = content.slice(0, cap);
  const boundary = Math.max(head.lastIndexOf("\n\n"), head.lastIndexOf(". "));
  const cut = boundary > cap / 2 ? head.slice(0, boundary + 1) : head.replace(/\s+\S*$/, "");
  return cut.trimEnd();
}

// A silent cut reads as a complete entry, so a clipped one names its own follow-up.
function renderMatch(match, cap) {
  const clipped = clip(match.content, cap);
  const header = `[[kb:${match.slug}]] ${match.title}`;
  if (clipped === match.content) return `${header}\n${clipped}`;
  return `${header}\n${clipped}\n[Entry truncated. Call lookup_kb with query "${match.title}" for the full text.]`;
}

function buildKbContextBlock(matches) {
  if (!Array.isArray(matches) || matches.length === 0) return "";
  const cap = KB_PREFLIGHT_CONTENT_CHARS || 800;
  const body = matches
    .map(m => renderMatch(m, cap))
    .join("\n\n");
  return [
    "[KnowledgeBase]",
    "Curated server knowledge that matches what is being discussed right now. Treat it as already retrieved — use it directly instead of calling lookup_kb, and cite it with [[cite:kb:slug]] when you rely on it.",
    body,
  ].join("\n");
}

module.exports = { findRelevant, buildKbContextBlock, invalidate, tokenize, scoreDocs, buildIndex };
