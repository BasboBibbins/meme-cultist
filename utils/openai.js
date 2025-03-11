const { OpenAIApi, Configuration } = require("openai");
const { PAST_MESSAGES } = require("../config.json");
const logger = require("./logger");

function estimateTokenCount(text) {
  const tokens = text.split(/[\s,.!?;:]+/).filter(Boolean); // Split by whitespace and punctuation; not 100% accurate
  return tokens.length;
}

async function handleBotMessage(client, message, key) {
  const configuration = new Configuration({
    apiKey: key,
    basePath: "https://api.deepseek.com"
  });
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
    let prompt = `You're a chatbot named ${client.user.displayName} speaking to ${users.join(", ")}, and ${lastUser}. When speaking, avoid starting your messages with your name unless it's necessary for clarity. Continue the conversation naturally and focus on engaging with the user.\n\n`;

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      prompt += `${m.member.displayName}: ${m.content}\n`;
    }
    logger.debug(`Generated Deepseek prompt: ${prompt}`);
    logger.debug(`Estimated token count: ${estimateTokenCount(prompt)}`);

    const completion = await openai.createChatCompletion({
      model: "deepseek-chat",
      messages: [
        { role: "user", content: prompt }
      ],
      max_tokens: 150
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

module.exports = { handleBotMessage };