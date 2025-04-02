const { OpenAIApi, Configuration } = require("openai");
const { PAST_MESSAGES, CHATBOT_LOCAL, BANNED_ROLE } = require("../config.json");
const logger = require("./logger");
const ip = `127.0.0.1`;

function estimateTokenCount(text) {
  const tokens = text.split(/[\s,.!?;:]+/).filter(Boolean); // Split by whitespace and punctuation; not 100% accurate
  return tokens.length;
}

function isSpamMessage(content) {
  const regex = [
    /(.)\1{9,}/,                        // 10+ repeated characters
    /([A-Z]{2,}\s+){3,}/,               // Multiple consecutive capitalized words
    /(https?:\/\/[^\s]+\s*){3,}/,       // 3+ URLs in message
    /(.{3,})\1{3,}/,                    // Same phrase repeated 4+ times
    /(?:discord\.gg|discordapp\.com\/invite)\/.+/i, // Discord invite links
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,  // Email addresses
    /\b\d{10,}\b/,                      // Long number sequences
    /(?:\s|^)\p{Emoji}{4,}(?:\s|$)/u,   // 4+ consecutive emojis
    /(?:\s|^)(?:http|www\.|bit\.ly).{1,}\s.{1,}(?:http|www\.|bit\.ly)/i // Multiple URLs with text between
  ];
  return regex.some(pattern => pattern.text(content));
}

async function runLocalModel() {
  const express = require('express');
  const axios = require('axios');
  const bodyParser = require('body-parser');
  
  const app = express();
  
  // Correct Middleware Order
  app.use(bodyParser.json()); // Ensures JSON request bodies are parsed correctly
  app.use(bodyParser.urlencoded({ extended: true })); // Optional for form data  
  
  app.post('/v1/chat/completions', async (req, res) => {
    logger.debug(`Received request: ${JSON.stringify(req.body)}`);

    const { messages, model } = req.body;

    if (!messages || !model) { 
      logger.error('Missing "messages" or "model" in request body.');
      return res.status(400).json({ error: 'Missing "messages" or "model" in request body.' });
    }

    const prompt = messages.map(msg => msg.content).join('\n');
    try {
      const response = await axios.post(`http://${ip}:11434/api/generate`, {
        model: model || 'deepseek-r1',
        prompt: prompt,
        stream: false
      });

      logger.debug(`Ollama response: ${response.data.response}`);

      res.json({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
            message: { role: 'assistant', content: response.data.response }
        }]
      });
    } catch (error) {
      logger.error(`Failed to generate response: ${error.message}`);
      res.status(500).json({ error: 'Failed to generate response.' });
    }
  });
  
  const PORT = 3000;
  app.listen(PORT, () => {
      logger.log(`Local LLM API running at \x1b[36mhttp://${ip}:${PORT}\x1b[0m`);
  });
}

async function handleBotMessage(client, message, key, customPrompt = null, channelId = null) {
  // sys message ignore
  logger.debug(`Received message: ${message.content} | Type: ${message.type} | Channel ID: ${channelId || message.channel.id}`);
  if (message.type != 0 && message.type != 19) {
    logger.debug(`System message detected, ignoring.`);
    return;
  }
  const configuration = new Configuration({
    apiKey: key,
    basePath: CHATBOT_LOCAL ? `http://${ip}:3000/v1/` : "https://api.deepseek.com"
  });
  logger.debug(`Using Deepseek API at ${configuration.basePath}`);
  logger.debug(`OpenAI API key: ${key.substring(0, 7)}...`);
  const openai = new OpenAIApi(configuration);

  let targetChannel;
  if (channelId) {
    targetChannel = client.channels.cache.get(channelId);
  } else {
    targetChannel = message.channel.isThread ? message.channel : message.channel;
  }

  const threadContext = targetChannel.isThread ? {
    name: targetChannel.name,
    parent: targetChannel.parent,
    author: targetChannel.ownerId,
    id: targetChannel.id,
    topic: targetChannel.topic || targetChannel.name,
  } : null;
  logger.debug(`Message sent in ${threadContext ? `thread ${threadContext.name}` : `channel ${targetChannel.name}`}`);

  if (!targetChannel) {
    logger.error(`Channel/thread not found: ${channelId || targetChannel.id}`);
    return;
  }

  let typing = true;
  const sendTyping = async () => {
    while (typing) {
      targetChannel.sendTyping();
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  };

  sendTyping();

  try {
    let prompt = "";
    if (!customPrompt && message && client) {
      let messages = Array.from(await targetChannel.messages.fetch({
        limit: 50, // to account for unwanted messages
        before: message.id
      }));
      messages = messages.map(m => m[1]);
      const isReply = message.type === 19;
      if (threadContext) {
        prompt = `You are a member of a Discord server called ${message.guild.name} and are in a thread called #${threadContext.name}. The thread's topic is "${threadContext.topic}".\n\nYour goal is to continue the conversation based on the thread topic. Use casual language, abbreviations, and humor when appropriate. Responses support Markdown and frequent emoji use is encouraged.\n\n`;
      } else {
        prompt = `You are a bot for a Discord server called ${message.guild.name}. Users in this chat will speak to you and expect a response. Your goal is to blend in with the conversation while keeping responses concise and in-tone with the conversation. Use casual language, abbreviations, and humor when appropriate. Responses support Markdown and frequent emoji use is encouraged.\n\n`;
      }
      if (isReply && (message.mentions.repliedUser === client.user)) {
        const msgReference = await targetChannel.messages.fetch(message.reference.messageId);
        prompt += `${message.member.displayName} replied to your message:\n${msgReference.content}\n\n`;
        prompt += `Now, respond to this reply in a fitting way without introduction or quotations:`;
      } else {
        prompt += messages.length > 0 ? `Here are some of the latest messages in the chat:\n\n` : ``;
        let validMessages = messages.filter(m => 
          m && m.member && 
          !m.hasThread && 
          !m.member.roles.cache.some(role => role.id === BANNED_ROLE)
        ).slice(0, PAST_MESSAGES);
        
        for (const m of validMessages.reverse()) {
          prompt += `${m.member.displayName}: ${m.content}\n`;
        }
        prompt += `\nNow, reply to this message in a fitting way without introduction or quotations:`;
      }
      prompt += `\n${message.member.displayName}: ${message.content}`;
    } else if (customPrompt) {
      prompt = customPrompt;
      logger.debug(`Using custom prompt: ${prompt}`);
    } else {
      // Fallback to a default prompt if no messages or custom prompt provided
      logger.debug("No messages found, using fallback prompt.");
      prompt = `You are a helpful assistant.\n`;
    }


    logger.debug(`Generated Deepseek prompt: ${prompt}`);
    logger.debug(`Estimated token count: ${estimateTokenCount(prompt)}`);

    const completion = await openai.createChatCompletion({
      "model": "deepseek-chat",
      "messages": [
          { "role": "system", "content": prompt }
      ],
      "temperature": 0.9,
    });
    
    logger.info(`Generated Deepseek response: ${completion.data.choices[0].message.content}`);
    logger.debug(`Prompt tokens: ${completion.data.usage.prompt_tokens} | Completion tokens: ${completion.data.usage.completion_tokens} | Total tokens: ${completion.data.usage.total_tokens}`);
    if (completion.data.choices[0].message.content.length > 2000) {
      logger.warn("Response exceeds Discord's character limit, splitting response into chunks.");
      const response = completion.data.choices[0].message.content;
      const chunks = response.match(/[\s\S]{1,1997}/g) || [];
      for (const chunk of chunks) {
        if (chunk !== chunks[chunks.length - 1]) {
          chunk += "..."; // Add ellipsis to indicate more content
        }
        await targetChannel.send(chunk);
      }
      logger.info(`Response sent in ${chunks.length} chunks.`);
      return;
    } else {
      logger.debug("Response is within Discord's character limit, sending as a single message.");
      targetChannel.send(completion.data.choices[0].message.content);
    }
  } catch (error) {
    targetChannel.send("I'm sorry, I couldn't generate a response.");
    logger.error(`Error generating response: ${error.message}`);
    if (error.response) {
      logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
    }
  } finally {
    typing = false;
  }
}

module.exports = { handleBotMessage, runLocalModel };