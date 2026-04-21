const { GoogleGenAI } = require("@google/genai");
const logger = require("./logger");
const { isSafeUrl } = require("./ssrf");

const VISION_MODEL = "gemini-2.5-flash";
/**
 * In it's current state, IMAGE_MODEL is passed through Cloudflare Workers AI REST API instead of the Gemini client.
 * As such it needs to be formatted as "[provider]/[model-name]"
 * Find the models here: https://developers.cloudflare.com/workers-ai/models/
 */
const IMAGE_MODEL = "black-forest-labs/flux-1-schnell";

let _geminiClient = null;
function getGeminiClient() {
  if (_geminiClient) return _geminiClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn("GEMINI_API_KEY is not set — Gemini features will be unavailable.");
    return null;
  }
  _geminiClient = new GoogleGenAI({ apiKey });
  return _geminiClient;
}

function withTimeout(promise, ms, err = "Gemini request timed out") {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(err)), ms)
  );
  return Promise.race([promise, timeout]);
}

async function describeImage(imageUrl, userHint = null) {
  const ai = getGeminiClient();
  if (!ai) return { error: "Vision is unavailable (GEMINI_API_KEY not configured)." };
  try {
    const urlCheck = isSafeUrl(imageUrl);
    if (!urlCheck.safe) {
      logger.warn(`[Gemini] Blocked unsafe image URL: ${imageUrl} (${urlCheck.reason})`);
      return { error: `Image URL is not allowed: ${urlCheck.reason}` };
    }
    const res = await fetch(imageUrl);
    if (!res.ok) {
      logger.warn(`[Gemini] Failed to fetch image (${res.status}): ${imageUrl}`);
      return { error: `Could not download the image (HTTP ${res.status}).` };
    }
    const mimeType = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    const base64 = buf.toString("base64");

  const promptText = userHint
    ? `A user has shared an image and asked: "${userHint}". Answer their question directly using the image as your source, and include any relevant context from the image that supports your answer.`
    : "Describe this image in 2-4 sentences. Note subjects, setting, mood, text, and anything unusual.";

    const result = await withTimeout(
      ai.models.generateContent({
        model: VISION_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { text: promptText },
              { inlineData: { mimeType, data: base64 } }
            ]
          }
        ]
      }),
      30_000,
      "Gemini describeImage timed out (30s)"
    );

    const text =
      result?.text ??
      result?.candidates?.[0]?.content?.parts?.find(p => p.text)?.text ??
      null;
    if (!text) {
      logger.warn("[Gemini] describeImage returned no text.");
      return { error: "Vision model returned no description (possibly blocked or filtered)." };
    }
    return { description: text.trim() };
  } catch (err) {
    logger.error(`[Gemini] describeImage failed: ${err.message}`);
    return { error: `Vision failed: ${err.message}` };
  }
}

// Gemini image generation is currently disabled because the models can't be accessed unless I set up billing. I will consider enabling it in the future if there's demand and I can find a way to mitigate spam/abuse risks. For now, I'm leaving the code here in case I want to enable it later.

// For now, here is an alternative using Cloudflare Workers AI REST API.
const CF_API_URL = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/@cf/${IMAGE_MODEL}`;

async function generateImage(prompt) {
  if (!process.env.CF_ACCOUNT_ID || !process.env.CF_API_KEY) {
    logger.error("[Gemini/CF] CF_ACCOUNT_ID or CF_API_KEY is not set.");
    throw new Error("CF_ACCOUNT_ID or CF_API_KEY is not set.");
  }

  logger.debug(`[Gemini/CF] generateImage prompt="${prompt}" url=${CF_API_URL}`);

  const response = await withTimeout(
    fetch(CF_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CF_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt }),
    }),
    60_000,
    "Cloudflare generateImage timed out (60s)"
  );

  logger.debug(`[Gemini/CF] response status=${response.status} ok=${response.ok} content-type=${response.headers.get("content-type")}`);

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    logger.error(`[Gemini/CF] non-OK response body: ${JSON.stringify(err)}`);
    throw new Error(`Cloudflare image generation failed: ${JSON.stringify(err)}`);
  }

  const body = await response.json();
  logger.debug(`[Gemini/CF] response body keys=[${Object.keys(body).join(", ")}] success=${body?.success} errors=${JSON.stringify(body?.errors)} messages=${JSON.stringify(body?.messages)}`);
  if (body?.result && typeof body.result === "object") {
    const resultKeys = Object.keys(body.result);
    logger.debug(`[Gemini/CF] body.result keys=[${resultKeys.join(", ")}]`);
    for (const k of resultKeys) {
      const v = body.result[k];
      const preview = typeof v === "string" ? `string(len=${v.length}) head="${v.slice(0, 60)}"` : `typeof=${typeof v}`;
      logger.debug(`[Gemini/CF] body.result.${k}: ${preview}`);
    }
  }

  const image = body?.result?.image;
  if (!image || typeof image !== "string") {
    logger.error(`[Gemini/CF] No base64 image in result. Full body preview: ${JSON.stringify(body).slice(0, 500)}`);
    throw new Error("Cloudflare returned no image data.");
  }

  const mimeType = image.startsWith("/9j/") ? "image/jpeg" : "image/png";
  logger.debug(`[Gemini/CF] decoding base64 image length=${image.length} mimeType=${mimeType}`);

  const buffer = Buffer.from(image, "base64");
  logger.debug(`[Gemini/CF] buffer size=${buffer.length} bytes`);

  return {
    buffer,
    mimeType,
    text: null
  };
}

/* 
async function generateImage(prompt) {
  const ai = getGeminiClient();
  if (!ai) throw new Error("GEMINI_API_KEY is not set.");

  const result = await withTimeout(
    ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseModalities: ["IMAGE", "TEXT"] }
    }),
    60_000,
    "Gemini generateImage timed out (60s)"
  );

  const parts = result?.candidates?.[0]?.content?.parts ?? [];
  let inline = null;
  let text = null;
  for (const part of parts) {
    if (part.inlineData?.data) inline = part.inlineData;
    else if (part.text) text = (text ? text + "\n" : "") + part.text;
  }
  if (!inline) {
    throw new Error("Gemini returned no image data.");
  }
  return {
    buffer: Buffer.from(inline.data, "base64"),
    mimeType: inline.mimeType || "image/png",
    text
  };
}
 */
module.exports = { describeImage, generateImage };
