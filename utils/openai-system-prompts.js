// Canonical system-prompt assembler for handleBotMessage.
// Enforces a fixed section order so DeepSeek cache prefixes stay stable.
//
// Order:
//   1. Variant prefix (static behavioral rules for this channel/thread type)
//   2. Topic / background
//   3. Channel facts
//   4. Channel summary
//   5. User summary
//   6. User facts
//   7. Tool instructions
//   8. Perception capabilities
//   9. Dynamic tail (time, users, speaker, reply context)

function assembleSystemPrompt(parts) {
    const sections = [
        parts.variantPrefix,
        parts.topic,
        parts.channelFactsBlock,
        parts.channelSummaryBlock,
        parts.userSummaryBlock,
        parts.userFactsBlock,
        parts.toolBlock,
        parts.perceptionBlock,
        parts.dynamicTail,
    ].filter(Boolean);
    return sections.join("\n\n");
}

module.exports = { assembleSystemPrompt };
