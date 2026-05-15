// Lightweight schema validation wrapper around ajv.
// All schemas are compiled once at require-time.

const Ajv = require("ajv");
const logger = require("./logger");
const llm = require("./llm");

const ajv = new Ajv({ strict: false });

const _validators = new Map();

function loadSchema(name) {
    if (_validators.has(name)) return _validators.get(name);
    const schema = require(`../schemas/${name}.json`);
    const validate = ajv.compile(schema);
    _validators.set(name, validate);
    return validate;
}

function cleanMarkdownCode(raw) {
    return raw
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```$/i, "")
        .trim();
}

function parseAndValidate(schemaName, rawString) {
    const validate = loadSchema(schemaName);
    const cleaned = cleanMarkdownCode(rawString);
    let parsed;
    try {
        parsed = JSON.parse(cleaned);
    } catch (err) {
        return { data: null, error: `JSON parse error: ${err.message}`, raw: cleaned };
    }
    const valid = validate(parsed);
    if (!valid) {
        const errors = validate.errors.map(e => `${e.instancePath || "root"}: ${e.message}`).join("; ");
        return { data: null, error: `Schema validation failed: ${errors}`, raw: cleaned };
    }
    return { data: parsed, error: null, raw: cleaned };
}

// Wraps llm.chat() with response_format + schema validation + one retry on failure.
async function chatWithSchema(args) {
    const { schemaName, ...llmArgs } = args;
    const validate = loadSchema(schemaName);

    const runChat = async (extraMessages = []) => {
        const res = await llm.chat({
            ...llmArgs,
            response_format: { type: "json_object" },
            messages: [...(llmArgs.messages || []), ...extraMessages],
        });
        return res;
    };

    const firstRes = await runChat();
    const firstRaw = firstRes.result.content?.trim() || "";
    const firstParsed = parseAndValidate(schemaName, firstRaw);
    if (!firstParsed.error) {
        return { ...firstRes, validated: firstParsed.data };
    }

    logger.warn(`[Schema] First attempt failed for "${schemaName}": ${firstParsed.error}. Retrying once.`);
    const retryRes = await runChat([
        { role: "user", content: `Your previous response violated the schema: ${firstParsed.error}. Please fix it and respond with valid JSON only.` },
    ]);
    const retryRaw = retryRes.result.content?.trim() || "";
    const retryParsed = parseAndValidate(schemaName, retryRaw);
    if (!retryParsed.error) {
        return { ...retryRes, validated: retryParsed.data };
    }

    logger.warn(`[Schema] Retry also failed for "${schemaName}": ${retryParsed.error}`);
    return { ...retryRes, validated: null, schemaError: retryParsed.error, raw: retryRaw };
}

module.exports = { parseAndValidate, chatWithSchema };
