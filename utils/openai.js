const { OpenAIApi, Configuration } = require("openai");
const { PAST_MESSAGES, CHATBOT_LOCAL } = require("../config.json");
const logger = require("./logger");
const ip = `127.0.0.1`;

function estimateTokenCount(text) {
  const tokens = text.split(/[\s,.!?;:]+/).filter(Boolean); // Split by whitespace and punctuation; not 100% accurate
  return tokens.length;
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

async function handleBotMessage(client, message, key, customPrompt = null) {
  const configuration = new Configuration({
    apiKey: key,
    basePath: CHATBOT_LOCAL ? `http://${ip}:3000/v1/` : "https://api.deepseek.com"
  });
  logger.debug(`Using Deepseek API at ${configuration.basePath}`);
  logger.debug(`OpenAI API key: ${key.substring(0, 7)}...`);
  const openai = new OpenAIApi(configuration);

  let typing = true;

  // typing indicator while generating response
  const sendTyping = async () => {
    while (typing) {
      message.channel.sendTyping();
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  };

  sendTyping();

  try {
    let messages = Array.from(await message.channel.messages.fetch({
      limit: PAST_MESSAGES - 1,
      before: message.id
    }));
    messages = messages.map(m => m[1]);
    messages.unshift(message);
    logger.debug(messages);
    let users = [...new Set([...messages.map(m => m.member.displayName), client.user.username])];
    let lastUser = users.pop();
    let prompt = customPrompt || `You're a user named ${client.user.displayName} (<@1348760795932000338>) in a chat room with ${users.join(", ")}, and ${lastUser}. When speaking, avoid starting your messages with your name unless it's necessary for clarity. Chime into the conversation using similar language and focus on engaging with everyone.\n\n`;

    if (!customPrompt) {
      // get history if no prompt
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        prompt += `${m.member.displayName}: ${m.content}\n`;
      }
    }

    logger.debug(`Generated Deepseek prompt: ${prompt}`);
    logger.debug(`Estimated token count: ${estimateTokenCount(prompt)}`);

    const completion = await openai.createChatCompletion({
      "model": "deepseek-chat",
      "messages": [
          { "role": "user", "content": prompt }
      ]
    });
    logger.info(`Generated Deepseek response: ${completion.data.choices[0].message.content}`);
    logger.debug(`Prompt tokens: ${completion.data.usage.prompt_tokens} | Completion tokens: ${completion.data.usage.completion_tokens} | Total tokens: ${completion.data.usage.total_tokens}`);
    message.channel.send(completion.data.choices[0].message.content);
  } catch (error) {
    message.channel.send("I'm sorry, I couldn't generate a response.");
    logger.error(`Error generating response: ${error.message}`);
    if (error.response) {
      logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
    }
  } finally {
    typing = false;
  }
}

module.exports = { handleBotMessage, runLocalModel };