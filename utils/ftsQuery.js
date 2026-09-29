const STOPWORDS = new Set([
  "the", "a", "an", "is", "was", "were", "are", "be", "been", "i", "you", "he", "she",
  "they", "we", "it", "that", "this", "what", "did", "do", "does", "how", "when",
  "where", "why", "who", "not", "no", "but", "and", "or", "if", "then", "so", "my",
  "your", "his", "her", "their", "our", "its", "at", "in", "on", "for", "of", "to",
  "with", "by", "from", "about", "said", "say", "says", "have", "has", "had",
  "would", "could", "should", "will", "can", "may", "might", "let", "get", "got",
  "make", "made", "know", "think", "want", "just", "like", "went", "come", "came",
  "go", "see", "saw", "tell", "told", "ask", "asked", "very", "really", "thing",
]);

function ftsTokens(rawQuery) {
  const words = String(rawQuery ?? "").toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
  return [...new Set(words.filter(w => w.length > 2 && !STOPWORDS.has(w)))];
}

// Every token is quoted, so punctuation, colons, and hyphens can never reach FTS5 as syntax.
function buildFTSQueries(rawQuery) {
  const tokens = ftsTokens(rawQuery);
  if (tokens.length === 0) return null;
  const quoted = tokens.map(t => `"${t}"`);
  return { tokens, all: quoted.join(" AND "), any: quoted.join(" OR ") };
}

// Reciprocal rank fusion: rank position, not raw score, so BM25 and cosine never need a shared scale.
function fuseRankings(lists, { k = 60, weightFor = () => 1, limit = 5 } = {}) {
  const byId = new Map();
  for (const rows of lists) {
    rows.forEach((row, i) => {
      const entry = byId.get(row.id) || { row, score: 0 };
      entry.score += 1 / (k + i + 1);
      byId.set(row.id, entry);
    });
  }
  return [...byId.values()]
    .map(e => ({ ...e, score: e.score * weightFor(e.row) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(e => e.row);
}

module.exports = { STOPWORDS, ftsTokens, buildFTSQueries, fuseRankings };
