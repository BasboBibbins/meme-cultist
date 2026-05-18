// Lightweight schema validation wrapper around ajv.
// All schemas are compiled once at require-time.

const Ajv = require("ajv");
const logger = require("./logger");
const llm = require("./llm");

// strict mode catches malformed schemas (typo'd `type`, unknown keywords) at
// compile time instead of silently passing everything through validation.
const ajv = new Ajv({ strict: true });

const _validators = new Map();

function loadSchema(name) {
    if (_validators.has(name)) return _validators.get(name);
    const schema = require(`../schemas/${name}.json`);
    const validate = ajv.compile(schema);
    _validators.set(name, validate);
    return validate;
}

// DeepSeek occasionally returns prose-wrapped JSON ("Sure, here is the JSON:
// ```json\n{...}\n```\nLet me know if…"). Strip outright if the whole reply
// is fenced; otherwise extract the first fenced block; otherwise carve out
// the first balanced object/array span. Falls back to the trimmed string so
// the JSON.parse error path still triggers on truly malformed input.
function cleanMarkdownCode(raw) {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return fenced[1].trim();
    const firstObj = trimmed.indexOf("{");
    const firstArr = trimmed.indexOf("[");
    let start = -1;
    let open = "";
    let close = "";
    if (firstObj !== -1 && (firstArr === -1 || firstObj < firstArr)) {
        start = firstObj; open = "{"; close = "}";
    } else if (firstArr !== -1) {
        start = firstArr; open = "["; close = "]";
    }
    if (start === -1) return trimmed;
    // Walk forward tracking depth and strings so braces inside string literals
    // do not throw off the balance count.
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (let i = start; i < trimmed.length; i++) {
        const ch = trimmed[i];
        if (inStr) {
            if (escape) { escape = false; continue; }
            if (ch === "\\") { escape = true; continue; }
            if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) return trimmed.slice(start, i + 1);
        }
    }
    return trimmed.slice(start);
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
