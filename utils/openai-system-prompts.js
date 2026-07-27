// Canonical system-prompt assembler for handleBotMessage.
// Enforces a fixed section order so DeepSeek cache prefixes stay stable.
//
// Order:
//   1. Variant prefix (static behavioral rules for this channel/thread type)
//   2. Topic / background
//   3. Identity rules
//   4. Discord formatting reference (static — kept high for cache reuse)
//   5. Standing directives (near-static per channel — kept high for cache reuse)
//   6. Channel facts
//   7. Channel summary
//   8. User summary
//   9. User facts
//  10. Knowledge-base context (pre-flight retrieval for this turn)
//  11. Tool instructions
//  12. Perception capabilities
//  13. Participants roster
//  14. Server emoji roster (dynamic — sits near participants)
//  15. Dynamic tail (time, users, speaker, reply context)

function assembleSystemPrompt(parts) {
  const sections = [
    parts.variantPrefix,
    parts.topic,
    parts.identityRulesBlock,
    parts.discordFormattingBlock,
    parts.directivesBlock,
    parts.channelFactsBlock,
    parts.channelSummaryBlock,
    parts.userSummaryBlock,
    parts.userFactsBlock,
    parts.kbContextBlock,
    parts.toolBlock,
    parts.perceptionBlock,
    parts.participantsBlock,
    parts.emojiBlock,
    parts.dynamicTail,
  ].filter(Boolean);
  return sections.join("\n\n");
}

module.exports = { assembleSystemPrompt };
