const { CHATBOT_CHANNELS } = require("../config.js");

/**
 * Resolve chatbot channel IDs to Discord mention strings.
 * Looks up each ID in the channel cache; returns a comma-separated
 * list of <#id> mentions, or the fallback text if none resolve.
 */
function formatChatbotChannelMentions(client, fallback = "the dedicated chatbot channel") {
  const mentions = CHATBOT_CHANNELS
    .map(id => client.channels.cache.get(id))
    .filter(Boolean)
    .map(ch => `<#${ch.id}>`);
  return mentions.length > 0 ? mentions.join(", ") : fallback;
}

/**
 * Check if a channel (or its parent) is a chatbot channel.
 */
function isChatbotChannel(channelId, parentId) {
  return CHATBOT_CHANNELS.includes(channelId) || CHATBOT_CHANNELS.includes(parentId);
}

module.exports = { formatChatbotChannelMentions, isChatbotChannel };