// Shared lexical helpers for the memory subsystems. Fact dedup, directive
// dedup, and knowledge-base pre-flight all need the same tokenize + overlap
// primitives; keeping three private copies let their stopword lists and
// minimum token lengths drift apart independently.
//
// minLength is the one genuine difference between call sites: fact and
// directive matching keep 2-character tokens, while KB matching discards them
// because short words match far too many entries.

// Two sets, because the call sites need different things. Semantic matching
// (facts, directives) must keep content words like "like", "want", and "know"
// — they carry meaning in a stored value ("likes ramen"). Retrieval matching
// (KB) discards them along with question words, which otherwise match every
// entry at once. Widening CORE would silently change fact dedup, so don't.
const CORE_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "is", "are",
  "was", "were", "i", "im", "me", "my", "you", "your", "it", "its", "this", "that",
  "for", "with", "as", "be", "do", "does", "did", "not", "no", "so", "if", "than",
  "then", "from", "by", "he", "she", "they", "we", "please", "just",
]);

const RETRIEVAL_STOPWORDS = new Set([
  ...CORE_STOPWORDS,
  "been", "what", "how", "when", "where", "why", "who", "can", "will", "get",
  "got", "have", "has", "had", "about", "like", "want", "know", "think",
  "there", "here",
]);

function tokenize(text, minLength = 2, stopwords = CORE_STOPWORDS) {
  return (text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t && t.length >= minLength && !stopwords.has(t));
}

function jaccard(a, b) {
  const setA = a instanceof Set ? a : new Set(tokenize(a));
  const setB = b instanceof Set ? b : new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersect = 0;
  for (const t of setA) if (setB.has(t)) intersect++;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersect / union;
}

// True when every meaningful token of `needle` appears in `haystack`. Jaccard
// alone cannot express "a short phrase naming a longer rule" — the length
// mismatch pushes the score below any useful threshold.
function containsAllTokens(haystack, needle) {
  const needleTokens = new Set(tokenize(needle));
  if (needleTokens.size === 0) return false;
  const haystackTokens = new Set(tokenize(haystack));
  for (const t of needleTokens) if (!haystackTokens.has(t)) return false;
  return true;
}

module.exports = { CORE_STOPWORDS, RETRIEVAL_STOPWORDS, tokenize, jaccard, containsAllTokens };
