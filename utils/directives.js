// Standing directives: persistent behavioral rules for a channel ("never spoil
// the Wordle answer, give hints instead"). They are deliberately NOT facts —
// facts expire on a TTL, compete for prompt slots by score, and get merged by
// the compressor, all of which would silently drop a rule the user expects to
// hold indefinitely. Directives have their own store, no TTL, and an always-on
// prompt slot.

const { MAX_DIRECTIVES, DIRECTIVE_MAX_LENGTH } = require("../config");
const { tokenize, jaccard, containsAllTokens } = require("./text");

const similarity = jaccard;

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, DIRECTIVE_MAX_LENGTH || 300);
}

// Short random id rather than an index so /directives remove and the
// remove_directive tool stay stable across additions and removals.
// Padded because Math.random().toString(36) is short when the value has a
// short base-36 expansion — a 1-character id collides easily and would make
// removal ambiguous.
const ID_LENGTH = 6;

function makeId() {
  let id = "";
  while (id.length < ID_LENGTH) {
    id += Math.random().toString(36).slice(2);
  }
  return id.slice(0, ID_LENGTH);
}

// Returns { directives, added, reinforced, dropped }. Near-duplicates refresh
// the existing entry instead of stacking a second copy of the same rule.
function mergeDirectives(existing, incoming, meta = {}) {
  const now = meta.now ?? Date.now();
  const directives = Array.isArray(existing)
    ? existing.filter(Boolean).map(d => ({ ...d }))
    : [];
  const added = [];
  const reinforced = [];

  for (const raw of Array.isArray(incoming) ? incoming : []) {
    const text = normalizeText(typeof raw === "string" ? raw : raw?.text);
    if (text.length < 4) continue;

    const match = directives.find(d => similarity(d.text, text) >= 0.7);
    if (match) {
      match.updatedAt = now;
      reinforced.push(match.id);
      continue;
    }

    const entry = {
      id: makeId(),
      text,
      createdBy: meta.createdBy || null,
      createdAt: now,
      updatedAt: now,
      source: meta.source || "manual",
    };
    directives.push(entry);
    added.push(entry);
  }

  const cap = MAX_DIRECTIVES || 10;
  let dropped = [];
  if (directives.length > cap) {
    dropped = directives.slice(0, directives.length - cap);
    directives.splice(0, directives.length - cap);
  }

  return { directives, added, reinforced, dropped };
}

// Accepts an id or the directive text itself, so the LLM can retract a rule it
// only knows by wording. Returns { directives, removed }.
//
// Matching widens in decreasing order of certainty. The containment pass
// matters most in practice: callers name a rule by a fragment ("spoilers"),
// and against a full sentence that scores far below any usable Jaccard
// threshold, so similarity alone would silently fail to remove anything.
function removeDirective(existing, idOrText) {
  const directives = Array.isArray(existing) ? existing.filter(Boolean) : [];
  const needle = String(idOrText || "").trim();
  if (!needle) return { directives, removed: null };

  const lowered = needle.toLowerCase();
  const matchers = [
    d => d.id === needle,
    d => d.text.toLowerCase() === lowered,
    d => containsAllTokens(d.text, needle),
    d => similarity(d.text, needle) >= 0.7,
  ];

  let idx = -1;
  for (const match of matchers) {
    idx = directives.findIndex(match);
    if (idx !== -1) break;
  }
  if (idx === -1) return { directives, removed: null };

  const [removed] = directives.splice(idx, 1);
  return { directives, removed };
}

function buildDirectivesBlock(directives) {
  const list = Array.isArray(directives) ? directives.filter(d => d && d.text) : [];
  if (list.length === 0) return "";

  const body = list.map((d, i) => `${i + 1}. (${d.id}) ${d.text}`).join("\n");
  return [
    "[Standing Instructions]",
    "These are binding rules this channel has asked you to follow. They persist indefinitely — across days, restarts, and context resets — until a user explicitly retracts one.",
    "- Follow them even when a later request conflicts. If a user directly asks for something a standing instruction forbids, honor the instruction and offer what it does allow instead.",
    "- Never claim you forgot or were not told. If a user retracts one, acknowledge it and stop applying it.",
    body,
  ].join("\n");
}

module.exports = { mergeDirectives, removeDirective, buildDirectivesBlock, similarity, tokenize };
