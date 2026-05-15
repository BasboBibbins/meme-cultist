// Bookmark → pinned fact pipeline. When a user reacts with the configured
// emoji (default 📌) on a chatbot-channel message, we run the immediate
// classifier on that message's content and write the resulting facts to the
// message author's user memory with `pinned: true`. Pinned facts bypass TTL
// expiration, compression merging, and the size cap.

const {
    getUserChatbotData,
    updateUserChatbotData,
    runImmediateClassifier,
    mergeFacts,
    sortAndPruneFacts,
} = require("./openai");
const { isChatbotChannel } = require("./channels");
const logger = require("./logger");
const { BOOKMARK_EMOJI, IMMEDIATE_FACTS_ENABLED } = require("../config.js");

async function handleBookmarkReaction(reaction, user) {
    if (user.bot) return;
    if (!IMMEDIATE_FACTS_ENABLED) {
        logger.debug(`[Bookmark] Immediate facts disabled in config; ignoring 📌 from ${user.tag}.`);
        return;
    }

    // Partials: emoji name, message content, channel parent — fetch what we need.
    if (reaction.partial) {
        try { await reaction.fetch(); }
        catch (err) { logger.warn(`[Bookmark] Failed to fetch partial reaction: ${err.message}`); return; }
    }
    const emojiName = reaction.emoji?.name;
    if (emojiName !== BOOKMARK_EMOJI) return;

    let message = reaction.message;
    if (message.partial) {
        try { message = await message.fetch(); }
        catch (err) { logger.warn(`[Bookmark] Failed to fetch partial message: ${err.message}`); return; }
    }

    const channel = message.channel;
    if (!channel?.id) return;
    if (!isChatbotChannel(channel.id, channel.parentId)) {
        logger.debug(`[Bookmark] 📌 ignored in non-chatbot channel ${channel.id}`);
        return;
    }

    const author = message.author;
    if (!author || author.bot) {
        logger.debug(`[Bookmark] 📌 on bot or unknown author — ignoring.`);
        return;
    }

    const content = (message.content || "").trim();
    if (content.length === 0) {
        logger.debug(`[Bookmark] 📌 on empty message ${message.id} — nothing to pin.`);
        return;
    }

    // Respect incognito: don't pin facts about a user who has opted out.
    const chatbot = await getUserChatbotData(author.id);
    const incog = Array.isArray(chatbot?.incognitoChannels) ? chatbot.incognitoChannels : [];
    if (chatbot?.incognitoMode || incog.includes(channel.id)) {
        logger.debug(`[Bookmark] 📌 ignored — author ${author.tag} is incognito here.`);
        return;
    }

    let parsed;
    try {
        parsed = await runImmediateClassifier(content, "user");
    } catch (err) {
        logger.warn(`[Bookmark] Classifier failed: ${err.message}`);
        return;
    }
    if (!parsed || parsed.length === 0) {
        logger.debug(`[Bookmark] Classifier extracted nothing from message ${message.id}.`);
        try { await reaction.message.react("❌"); } catch (_) {}
        return;
    }

    const tagged = parsed.map(f => ({
        key: f.key,
        value: f.value,
        confidence: "high",
        pinned: true,
        reinforcedCount: Number.MAX_SAFE_INTEGER,
        extractedFrom: `bookmark:${message.id}`,
    }));

    const merged = mergeFacts(chatbot.facts || [], tagged, content);
    // Ensure the pinned flag survives mergeFacts (which only carries it forward for existing-as-pinned).
    for (const t of tagged) {
        const hit = merged.find(f => f.key === t.key);
        if (hit) {
            hit.pinned = true;
            hit.reinforcedCount = Number.MAX_SAFE_INTEGER;
            hit.confidence = "high";
        }
    }
    const next = sortAndPruneFacts(merged);
    await updateUserChatbotData(author.id, { facts: next });

    logger.log(`[Bookmark] ${user.tag} pinned ${tagged.length} fact(s) about ${author.tag} from message ${message.id}: ${tagged.map(t => t.key).join(", ")}`);
    try { await reaction.message.react("✅"); } catch (_) {}
}

module.exports = { handleBookmarkReaction };
