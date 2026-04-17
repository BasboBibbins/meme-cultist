const cheerio = require("cheerio");
const logger = require("./logger");

const URL_REGEX = /(https?:\/\/[^\s<>"']+)/i;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function extractFirstUrl(text) {
  if (!text || typeof text !== "string") return null;
  const match = text.match(URL_REGEX);
  return match ? match[1] : null;
}

async function fetchPageText(url, maxChars = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "meme-cultist/1.0",
        "accept": "text/html,application/xhtml+xml"
      },
      redirect: "follow",
      signal: controller.signal
    });
    if (!res.ok) {
      logger.debug(`[urlContext] non-2xx ${res.status} for ${url}`);
      return { url, error: `HTTP ${res.status} ${res.statusText || ""}`.trim() };
    }
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("text/html")) {
      logger.debug(`[urlContext] non-HTML content-type (${contentType}) for ${url}`);
      return { url, error: `Unsupported content-type: ${contentType || "unknown"}` };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BODY_BYTES) {
      logger.debug(`[urlContext] body too large (${buf.byteLength}B) for ${url}`);
      return { url, error: "Page body exceeds 2MB size limit." };
    }

    const $ = cheerio.load(buf.toString("utf8"));
    $("script, style, noscript, nav, footer, aside, header").remove();

    const title = $("title").first().text().trim();
    const parts = [];
    $("h1, h2, h3, h4, h5, h6, p, li, article, main").each((_, el) => {
      const t = $(el).text().replace(/\s+/g, " ").trim();
      if (t) parts.push(t);
    });

    let text = parts.join("\n").replace(/\n{2,}/g, "\n").trim();
    if (text.length > maxChars) text = text.slice(0, maxChars) + "…";
    if (!text) return { url, error: "Page contained no readable text." };

    return { title, text, url };
  } catch (err) {
    logger.debug(`[urlContext] fetch failed for ${url}: ${err.message}`);
    const reason = err.name === "AbortError" ? "Fetch timed out after 8s." : err.message;
    return { url, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { extractFirstUrl, fetchPageText };
