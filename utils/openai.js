const { OpenAIApi, Configuration } = require("openai");
const { PAST_MESSAGES, CHATBOT_LOCAL, BANNED_ROLE, OOC_PREFIX } = require("../config.json");
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: `./db/thread_contexts.sqlite` });
const logger = require("./logger");
const ip = `127.0.0.1`;

function estimateTokenCount(text) {
  const tokens = text.split(/[\s,.!?;:]+/).filter(Boolean); // Split by whitespace and punctuation; not 100% accurate
  return tokens.length;
}

async function getValidMessages(channel, message) {
  let messages = Array.from(await channel.messages.fetch({
    limit: PAST_MESSAGES * 10, // to account for unwanted messages
    before: message.id
  }));
  messages = messages.map(m => m[1]);
  let validMessages = messages.filter(m => 
    m && m.member && 
    !m.hasThread && 
    !m.content.startsWith(OOC_PREFIX) &&
    !m.member.roles.cache.some(role => role.id === BANNED_ROLE)
  ).slice(0, PAST_MESSAGES);

  return validMessages;
}

async function getDefaultThreadContext(thread) {
  return {
    id: thread.id,
    name: thread.name,
    parent: thread.parent,
    author: thread.ownerId,
    roleplay_options: {
      characteristics: '',
      personality: '',
      preferences: '',
      dialog: '',
      boundaries: '',
    },
    topic: '',
    summaries: []
  }
}

async function addNewThreadContext(thread) {
  const dbThread = await db.get(thread.id);
  const defaultDB = await getDefaultThreadContext(thread);
  if (!dbThread) {
    await db.set(thread.id, defaultDB);
  }
  logger.log(`Added thread context for ${thread.name} [${thread.id}] to the database.`);
}

async function deleteThreadContext(thread) {
  const dbThread = await db.get(thread.id);
  if (dbThread) {
    await db.delete(thread.id);
    logger.log(`Deleted thread context for ${thread.name} [${thread.id}] from the database.`);
  } else {
    logger.warn(`No thread context found for ${thread.name} [${thread.id}] in the database.`);
  }
}

async function getThreadContext(thread) {
  const dbThread = await db.get(thread.id);
  if (dbThread) {
    return dbThread;
  } else {
    await addNewThreadContext(thread);
    return getDefaultThreadContext(thread);
  }
}

async function updateThreadContext(thread, updates) {
  const dbThread = await db.get(thread.id);
  if (dbThread) {
    Object.keys(updates).forEach((key) => {
      dbThread[key] = updates[key];
    });
    await db.set(thread.id, dbThread);
    logger.log(`Updated thread context for thread ${thread.name} [${thread.id}]`);
  }
}

async function summarizeMessages(messages, thread, key) {
  const configuration = new Configuration({
    apiKey: key,
    basePath: CHATBOT_LOCAL ? `http://${ip}:3000/v1/` : "https://api.deepseek.com"
  });
  logger.debug(`Using Deepseek API at ${configuration.basePath}`);
  logger.debug(`OpenAI API key: ${key.substring(0, 7)}...`);
  const openai = new OpenAIApi(configuration);
  const context = await getThreadContext(thread);
  if (!context) return;
  const prev_summaries = context.summaries;
  const lines = [
    `You are a memory compression assistant. Summarize this conversation in 4-6 concise bullet points, focusing on:`,
    `- What the user is trying to talk about or achieve`,
    `- Any important facts, preferences, or decisions`,
    `- Key context that a chatbot should remember in future replies`,
    `- Maintain useful long-term knowledge of the user and the discussion`,
    prev_summaries.length > 0 && `Use this previous summary as context: ${prev_summaries[prev_summaries.length - 1]}`,
    messages && `Conversation:\n${messages.join('\n')}\n` // TODO: change to include username of message author
  ]

  const prompt = lines.filter(Boolean).join('\n')
  logger.debug(prompt);
  const res = await openai.createChatCompletion({
    "model": "deepseek-chat",
    "messages": [
      { role: "system", content: "You summarize chat conversations into useful memory, responding with only the summary body." },
      { role: "user", content: prompt }
    ],
    "max_tokens": 1024,
    "temperature": 0.3
  });
  const { choices } = res.data;
  if (choices.length > 0 && choices[0].message) {
    const summary = choices[0].message.content.trim();
    logger.log(`Summarized thread ${thread.name} [${thread.id}]`);
    await updateThreadContext(thread, { summaries: [...context.summaries, summary] });
    logger.debug(`Prompt tokens: ${res.data.usage.prompt_tokens} | Completion tokens: ${res.data.usage.completion_tokens} | Total tokens: ${res.data.usage.total_tokens}`);
    return summary;
  } else {
    throw new Error("No response from OpenAI");
  }
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
    targetChannel = message.channel.isThread() ? message.channel : message.channel;
  }

  const threadContext = await getThreadContext(targetChannel);
  let validMessages = await getValidMessages(targetChannel, message);

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
    let sys_prompt = "";
    let usr_prompt = "";
    if (!customPrompt && message && client) {
      let messages = Array.from(await targetChannel.messages.fetch({
        limit: PAST_MESSAGES * 10, // to account for unwanted messages
        before: message.id
      }));
      messages = messages.map(m => m[1]);
      const isReply = message.type === 19;
      if (targetChannel.isThread()) {
        const authorName = message.guild.members.cache.get(threadContext.author)?.displayName || message.member.displayName;
        const {
          name,
          topic,
          roleplay_options = {},
          summaries
        } = threadContext;
        const {
          characteristics,
          personality,
          preferences,
          dialog,
          boundaries,
        } = roleplay_options;
        const hasRoleplayData = [
          characteristics,
          personality,
          preferences,
          dialog,
          boundaries
        ].some(value => value && value.trim() !== "");

        if (!hasRoleplayData) {
          sys_prompt += `You are an AI assistant for a Discord server called ${message.guild.name} participating in a thread called #${name} created by ${authorName}. The thread's topic is "${topic || name}".\n\nYour role is to stay on topic and follow the instructions of the thread's owner, ${authorName}.\n\n`;
          sys_prompt += `Rules:\nStick strictly to the topic of the thread.\nAlways prioritize and follow the requests of ${authorName}.\nKeep responses relevant, concise, and engaging.\nDo not speak in quotations or introduce yourself.`
        } else {
          const lines = [
            `You are roleplaying as a character in a thread called "${name}" created by ${authorName}.`,
            topic && `The current topic is "${topic}".`,
            characteristics && `Your character has the following characteristics: ${characteristics}`,
            personality && `Your character's personality is: ${personality}`,
            preferences && `Your character's prefers to: ${preferences}`,
            dialog && `Speak in a ${dialog} tone.`,
            boundaries && `Your character's boundaries: ${boundaries}`,
            `Stay in character. Do not mention the fact that you're an AI assistant.`
          ]
          sys_prompt += lines.filter(Boolean).join('\n')
        }
        if (summaries.length > 0) {
          sys_prompt += `\n\nHere is a quick summary of the thread so far:\n${summaries[summaries.length - 1]}`
        }
      } else {
        sys_prompt = `You are an AI assistant in a casual Discord channel in a server called ${message.guild.name}. In this chat, users have open-ended conversations. Your goal is to engage in conversation while keeping responses natural and flowing.\n\n`;
        sys_prompt += `Rules:\nBe engaging and responsive to user input, but avoid dominating the conversation.\nIf a user shares something or switches the conversation, react natually and build on the discussion.\nRespond using casual language, abbreviations, and humor when appropriate.\nDark humor and unethical responses are allowed and expected of the users.\n\n`
      }
      if (isReply && (message.mentions.repliedUser === client.user)) {
        const msgReference = await targetChannel.messages.fetch(message.reference.messageId);
        sys_prompt += `${message.member.displayName} replied to your message:\n${msgReference.content}\n\n`;
        sys_prompt += `Now, respond to this reply in a fitting way without introduction or quotations:`;
      } else {
        sys_prompt += messages.length > 0 ? `\n\nHere are some of the latest messages in the chat:\n` : ``;

        for (const m of validMessages.reverse()) {
          sys_prompt += `${m.member.displayName}: ${m.content}\n`;
        }
        sys_prompt += `\nNow, reply to this message in a fitting way that aligns with the rules:`;
      }
      usr_prompt += `\n${message.member.displayName}: ${message.content}`;
    } else if (customPrompt) {
      sys_prompt = customPrompt;
      logger.debug(`Using custom prompt: ${sys_prompt}`);
    } else {
      // Fallback to a default prompt if no messages or custom prompt provided
      logger.debug("No messages found, using fallback prompt.");
      sys_prompt = `You are a helpful assistant.\n`;
    }

    logger.debug(`Deepseek prompt:\nSYS_PROMPT: ${sys_prompt}\nUSR_PROMPT: ${usr_prompt}`);
    logger.debug(`Estimated token count: ${estimateTokenCount(sys_prompt)}`);

    const completion = await openai.createChatCompletion({
      "model": "deepseek-chat",
      "messages": [
        { "role": "system", "content": sys_prompt },
        { "role": "user", "content": usr_prompt },
      ],
      "temperature": 0.8,
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

module.exports = { handleBotMessage, runLocalModel, updateThreadContext, addNewThreadContext, getThreadContext, getThreadContext, deleteThreadContext, getValidMessages, summarizeMessages };