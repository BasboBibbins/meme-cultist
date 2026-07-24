// Canonical system-prompt assembler for handleBotMessage.
// Enforces a fixed section order so DeepSeek cache prefixes stay stable.
//
// Order:
//   1. Variant prefix (static behavioral rules for this channel/thread type)
//   2. Topic / background
//   3. Identity rules
//   4. Standing directives (near-static per channel — kept high for cache reuse)
//   5. Channel facts
//   6. Channel summary
//   7. User summary
//   8. User facts
//   9. Knowledge-base context (pre-flight retrieval for this turn)
//  10. Tool instructions
//  11. Perception capabilities
//  12. Participants roster
//  13. Dynamic tail (time, users, speaker, reply context)

function assembleSystemPrompt(parts) {
  const sections = [
    parts.variantPrefix,
    parts.topic,
    parts.identityRulesBlock,
    parts.directivesBlock,
    parts.channelFactsBlock,
    parts.channelSummaryBlock,
    parts.userSummaryBlock,
    parts.userFactsBlock,
    parts.kbContextBlock,
    parts.toolBlock,
    parts.perceptionBlock,
    parts.participantsBlock,
    parts.dynamicTail,
  ].filter(Boolean);
  return sections.join("\n\n");
}

module.exports = { assembleSystemPrompt };
