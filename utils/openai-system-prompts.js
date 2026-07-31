// Canonical prompt assemblers for handleBotMessage.
//
// DeepSeek's context cache is a strict prefix cache: the reusable region is the
// longest common token prefix with an earlier request, and a miss costs 10x a
// hit. So the split below is not cosmetic — sections are ordered by descending
// expected lifetime, and anything that changes every turn is kept out of the
// system message entirely.
//
// System message (stable, cached):
//   1. Variant prefix (behavioral rules for this channel/thread type)
//   2. Identity rules
//   3. Discord formatting reference
//   4. Turn-context legend
//   5. Tool instructions
//   6. Server emoji roster
//   7. Standing directives
//   8. Channel topic
//   9. Channel summary
//  10. Participants roster
//
// Turn context (volatile, rides on the final user message — which is never part
// of a reusable prefix, so volatility is free there and the retrieval lands
// nearer the question it has to answer).

function assembleSystemPrompt(parts) {
  const sections = [
    parts.variantPrefix,
    parts.identityRulesBlock,
    parts.discordFormattingBlock,
    parts.turnContextLegendBlock,
    parts.toolBlock,
    parts.emojiBlock,
    parts.directivesBlock,
    parts.topicBlock,
    parts.channelSummaryBlock,
    parts.participantsBlock,
  ].filter(Boolean);
  return sections.join("\n\n");
}

function assembleTurnContext(parts) {
  const sections = [
    parts.channelFactsBlock,
    parts.userSummaryBlock,
    parts.userFactsBlock,
    parts.kbContextBlock,
    parts.perceptionBlock,
    parts.perceptionPayload,
    parts.turnModeBlock,
    parts.replyBlock,
    parts.nowBlock,
    parts.userLine,
  ].filter(Boolean);
  return sections.join("\n\n");
}

// Tells the model that the bracketed blocks riding on a user turn are
// system-supplied context, not something the user typed.
const TURN_CONTEXT_LEGEND_BLOCK = [
  "[Turn Context]",
  "Each user turn may be preceded by bracketed context blocks supplied by the system, not typed by the user: [ChannelFacts], [UserFacts], [UserSummary], [KnowledgeBase], [Perception], [Turn Mode], [ReplyTo], and [Now].",
  "- Treat them as your own knowledge and perception. Never quote them back, never mention that you were given them, and never address them as if the user wrote them.",
  "- The actual message to respond to is the final line, prefixed with [user_NNN].",
  "- When a [ReplyTo] block is present, the user is replying to the quoted message. Respond to their reply in a fitting way, without introduction or quotations.",
].join("\n");

// Summary age feeds the cached prefix. Minute granularity rewrote the block
// every 60 seconds and invalidated everything after it, so recency is bucketed
// instead — coarse enough to hold still for a summary's whole lifetime, which is
// all the model needs in order to judge staleness.
function formatAgeBucket(timestamp, now = Date.now()) {
  if (!timestamp) return "just now";
  const hours = Math.max(0, now - timestamp) / 3600000;
  if (hours < 2) return "just now";
  if (hours < 8) return "earlier today";
  if (hours < 24) return "today";
  if (hours < 48) return "yesterday";
  if (hours < 168) return "this week";
  return "older";
}

module.exports = { assembleSystemPrompt, assembleTurnContext, formatAgeBucket, TURN_CONTEXT_LEGEND_BLOCK };
