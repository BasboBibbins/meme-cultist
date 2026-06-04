// Canonical system-prompt assembler for handleBotMessage.
// Enforces a fixed section order so DeepSeek cache prefixes stay stable.
//
// Order:
//   1. Variant prefix (static behavioral rules for this channel/thread type)
//   2. Topic / background
//   3. Identity rules 
//   4. Channel facts
//   5. Channel summary
//   6. User summary
//   7. User facts
//   8. Tool instructions
//   9. Perception capabilities
//  10. Participants roster
//  11. Dynamic tail (time, users, speaker, reply context)

function assembleSystemPrompt(parts) {
  const sections = [
    parts.variantPrefix,
    parts.topic,
    parts.identityRulesBlock,
    parts.channelFactsBlock,
    parts.channelSummaryBlock,
    parts.userSummaryBlock,
    parts.userFactsBlock,
    parts.toolBlock,
    parts.perceptionBlock,
    parts.participantsBlock,
    parts.dynamicTail,
  ].filter(Boolean);
  return sections.join("\n\n");
}

module.exports = { assembleSystemPrompt };
