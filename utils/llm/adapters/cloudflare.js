// Cloudflare Workers AI adapter. Currently used for image generation
// (black-forest-labs/flux-1-schnell) as a Gemini fallback.
//
// dotenv-first invariant: bot.js loads dotenv before any require chain that
// reaches this file. Do not require this adapter from a context that runs
// before dotenv (e.g. a standalone test harness) without loading the env
// yourself first.

const config = require("../../../config.js");
const logger = require("../../logger");

const IMAGE_MODEL = "black-forest-labs/flux-1-schnell";
const EMBED_MODEL = "baai/bge-base-en-v1.5";

function imageUrl() {
  return `https://api.cloudflare.com/client/v4/accounts/${config.CF_ACCOUNT_ID}/ai/run/@cf/${IMAGE_MODEL}`;
}

function embedUrl() {
  return `https://api.cloudflare.com/client/v4/accounts/${config.CF_ACCOUNT_ID}/ai/run/@cf/${EMBED_MODEL}`;
}

async function generateImage({ prompt }) {
  if (!config.CF_ACCOUNT_ID || !config.CF_API_KEY) {
    logger.error("[CF] CF_ACCOUNT_ID or CF_API_KEY is not set.");
    throw new Error("CF_ACCOUNT_ID or CF_API_KEY is not set.");
  }

  const url = imageUrl();
  logger.debug(`[CF] generateImage prompt="${prompt}" url=${url}`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.CF_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt }),
  });

  logger.debug(`[CF] response status=${response.status} ok=${response.ok} content-type=${response.headers.get("content-type")}`);

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    logger.error(`[CF] non-OK response body: ${JSON.stringify(err)}`);
    throw new Error(`Cloudflare image generation failed: ${JSON.stringify(err)}`);
  }

  const body = await response.json();
  const image = body?.result?.image;
  if (!image || typeof image !== "string") {
    logger.error(`[CF] No base64 image in result. Full body preview: ${JSON.stringify(body).slice(0, 500)}`);
    throw new Error("Cloudflare returned no image data.");
  }

  const mimeType = image.startsWith("/9j/") ? "image/jpeg" : "image/png";
  const buffer = Buffer.from(image, "base64");
  logger.debug(`[CF] decoded image buffer=${buffer.length} bytes mime=${mimeType}`);

  return { buffer, mimeType, text: null };
}

async function embedText({ text }) {
  if (!config.CF_ACCOUNT_ID || !config.CF_API_KEY) {
    logger.error("[CF] CF_ACCOUNT_ID or CF_API_KEY is not set.");
    throw new Error("CF_ACCOUNT_ID or CF_API_KEY is not set.");
  }

  const url = embedUrl();
  logger.debug(`[CF] embedText text="${text.slice(0, 80)}..." url=${url}`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.CF_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    logger.error(`[CF] embed non-OK response body: ${JSON.stringify(err)}`);
    throw new Error(`Cloudflare embed failed: ${JSON.stringify(err)}`);
  }

  const body = await response.json();
  const embedding = body?.result?.data?.[0];
  if (!Array.isArray(embedding)) {
    logger.error(`[CF] No embedding in result. Full body preview: ${JSON.stringify(body).slice(0, 500)}`);
    throw new Error("Cloudflare returned no embedding data.");
  }

  const floatArray = new Float32Array(embedding);
  logger.debug(`[CF] embedding length=${floatArray.length}`);
  return { embedding: floatArray };
}

module.exports = { generateImage, embedText };
