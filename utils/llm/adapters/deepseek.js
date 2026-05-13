// DeepSeek chat completions via the OpenAI SDK v3 compatibility layer.
// This module owns the single DeepSeek client used across the bot — no other
// file should construct `new OpenAIApi(...)`. Adapter is retry- and timeout-
// naive; the router wraps it.

const { OpenAIApi, Configuration } = require("openai");
const { CHATBOT_LOCAL } = require("../../../config.js");
const logger = require("../../logger");

let _client = null;
let _clientKey = null;

function getClient() {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not set.");
    if (_client && _clientKey === key) return _client;

    const configuration = new Configuration({
        apiKey: key,
        basePath: CHATBOT_LOCAL ? "http://127.0.0.1:3000/v1/" : "https://api.deepseek.com",
    });
    logger.debug(`Using Deepseek API at ${configuration.basePath}`);
    logger.debug(`OpenAI API key: ${key.substring(0, 7)}...`);
    _client = new OpenAIApi(configuration);
    _clientKey = key;
    return _client;
}

async function chat(args) {
    const client = getClient();
    const payload = {
        model: args.model,
        messages: args.messages,
    };
    if (args.temperature !== undefined) payload.temperature = args.temperature;
    if (args.max_tokens !== undefined) payload.max_tokens = args.max_tokens;
    if (args.tools !== undefined) payload.tools = args.tools;
    if (args.tool_choice !== undefined) payload.tool_choice = args.tool_choice;
    if (args.response_format !== undefined) payload.response_format = args.response_format;

    const raw = await client.createChatCompletion(payload);
    const choice = raw?.data?.choices?.[0];
    const message = choice?.message || {};
    return {
        result: {
            content: message.content ?? "",
            tool_calls: message.tool_calls,
            finish_reason: choice?.finish_reason,
        },
        usage: raw?.data?.usage || {},
        raw,
    };
}

module.exports = { chat, getClient };
