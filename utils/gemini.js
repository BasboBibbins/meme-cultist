const { GoogleGenAI } = require("@google/genai");
const logger = require("./logger");

const VISION_MODEL = "gemini-2.5-flash";
const IMAGE_MODEL = "gemini-2.5-flash-image";

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

module.exports = { describeImage, generateImage };
