const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { QuickDB } = require("quick.db");
const logger = require("../../utils/logger");
const llm = require("../../utils/llm");
const { buildBaseEmbed, buildErrorEmbed, buildInfoEmbed, buildSuccessEmbed, COLORS } = require("../../utils/embeds");
const { sendDM } = require("../../utils/dm");
const { chatWithSchema } = require("../../utils/schemas");
const {
  TYPE_LABELS, TYPE_GLYPHS, EMBED_DESCRIPTION_LIMIT, buildFeedbackModal,
  readFeedbackType, readFeedbackValues, readScreenshotUrl,
  composeDescription, clamp, descriptionFallbackTitle,
} = require("../../utils/feedbackForm");
const { CONVO_MODEL, OWNER_ID, GITHUB_REPO_OWNER, GITHUB_REPO_NAME } = require("../../config.js");

const feedbackDb = new QuickDB({ filePath: "./db/feedback.sqlite" });

function llmAvailable() {
  if (!process.env.OPENAI_API_KEY) {
    logger.error("[Feedback] OPENAI_API_KEY not found in environment");
    return false;
  }
  return true;
}

function cleanMarkdownCode(content) {
  if (!content) return content;
  content = content.trim();
  // Strip fenced code blocks (```json ... ``` or ``` ... ```)
  if (content.startsWith("```")) {
    const firstNewline = content.indexOf("\n");
    if (firstNewline !== -1) {
      content = content.slice(firstNewline + 1);
    } else {
      content = content.slice(3);
    }
    if (content.endsWith("```")) {
      content = content.slice(0, -3).trim();
    }
  }
  // Strip inline backticks
  if (content.startsWith("`") && content.endsWith("`")) {
    content = content.slice(1, -1).trim();
  }
  return content;
}

const COMPONENTS = ["chatbot", "games", "themes", "general"];
const MODAL_TIMEOUT_MS = 10 * 60 * 1000;

// An LLM outage is not evidence the submission was bad, so no unrecoverable
// branch may reject a user's feedback.
function failOpen(reason) {
  return { valid: true, reason, category: "unknown", component: "general" };
}

async function validateFeedback(type, description, username) {
  if (!llmAvailable()) return failOpen("API unavailable");

  // Keys and types must match schemas/feedback-validation.json — it is
  // additionalProperties:false with all four required, so omitting them here
  // fails validation on every call.
  const prompt = `You are a content moderator. Analyze this feedback and respond with ONLY valid JSON.

Feedback Type: ${TYPE_LABELS[type]}
From User: ${username}
Content: "${description}"

Respond with a JSON object containing exactly these four keys:
- "valid": boolean — true if the feedback is legitimate, false otherwise.
- "reason": string — a brief explanation of your decision, or "" if legitimate.
- "category": string — one of "legitimate", "spam", "abusive", "nonsense", "empty".
- "component": string — one of "chatbot", "games", "themes", "general".

Category meanings:
- legitimate: genuine bug reports, feature suggestions, or constructive feedback.
- spam: repetitive, advertisements, gibberish.
- abusive: harassment, threats, hate speech.
- nonsense: random characters, meaningless.
- empty: < 5 characters of content.

Component meanings (what part of the bot this relates to):
- chatbot: AI chatbot, memory, personas, knowledge base, reminders, chat behaviour.
- games: casino games (craps, duel, slots, blackjack, poker, roulette, race, shop).
- themes: visual appearance, cosmetics, card art, table colours.
- general: bot-wide issues, currency/economy, commands not covered above, or unclear.

Example: {"valid": true, "reason": "", "category": "legitimate", "component": "games"}`;

  try {
    const response = await chatWithSchema({
      schemaName: "feedback-validation",
      model: CONVO_MODEL,
      messages: [
        { role: "system", content: "You respond only with valid JSON." },
        { role: "user", content: prompt },
      ],
      // Reasoning tokens eat ~100 of the completion budget before any content
      // is emitted, so a tighter cap truncates the JSON mid-object.
      max_tokens: 500,
      temperature: 0.1,
      label: "validateFeedback",
      variant: "validate_feedback",
    });

    if (response.validated && typeof response.validated.valid === "boolean") {
      return response.validated;
    }
    logger.warn(`[Feedback] Schema validation failed: ${response.schemaError}. Falling back to legacy parser.`);
    let content = response.result.content?.trim();
    if (!content) return failOpen("Empty response");
    content = cleanMarkdownCode(content);
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      logger.warn(`[Feedback] Legacy parse failed: ${error.message}`);
      return failOpen("Unparseable response");
    }
    // A schema-invalid object still parses, so nothing below is trusted untyped.
    if (typeof parsed.valid !== "boolean") return failOpen("Malformed response");
    return {
      valid: parsed.valid,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
      category: typeof parsed.category === "string" ? parsed.category : "unknown",
      // Component becomes a GitHub label; an invented one fails issue creation.
      component: COMPONENTS.includes(parsed.component) ? parsed.component : "general",
    };
  } catch (error) {
    logger.error(`[Feedback] Validation error: ${error.message}`);
    return failOpen("Validation unavailable");
  }
}

async function notifyOwner(client, feedback) {
  try {
    const owner = await client.users.fetch(OWNER_ID);
    if (!owner) {
      logger.error("[Feedback] Could not fetch owner");
      return false;
    }

    const fakeUser = { displayName: feedback.username, displayAvatarURL: () => feedback.avatarURL };
    const color = feedback.type === "bug" ? COLORS.error : feedback.type === "suggestion" ? COLORS.success : COLORS.primary;
    const embed = buildBaseEmbed(fakeUser, client)
      .setAuthor({ name: `New Feedback from ${feedback.username}`, iconURL: feedback.avatarURL })
      .setTitle(`${TYPE_GLYPHS[feedback.type]} ${TYPE_LABELS[feedback.type]}`)
      .setDescription(clamp(feedback.description, EMBED_DESCRIPTION_LIMIT))
      .setColor(color)
      .addFields(
        { name: "User", value: `${feedback.username} (${feedback.userId})`, inline: true },
        { name: "Category", value: feedback.category || "unknown", inline: true },
        { name: "Component", value: feedback.component || "general", inline: true },
        { name: "Guild", value: feedback.guildName || "Unknown", inline: true }
      );

    // Without this the operator cannot tell a screened submission from one the
    // moderator failed open on — both read as "unknown".
    if (feedback.category === "unknown" && feedback.validationReason) {
      embed.addFields({ name: "Not screened", value: clamp(feedback.validationReason, 1024) });
    }

    if (feedback.screenshotUrl) embed.setImage(feedback.screenshotUrl);

    if (feedback.type === "bug" || feedback.type === "suggestion") {
      embed.addFields({
        name: "GitHub Issue",
        value: clamp(feedback.issueUrl || `Failed: ${feedback.githubError || "Unknown error"}`, 1024)
      });
    }

    const sent = await sendDM(owner, { embeds: [embed] });
    // sendDM returns null when the owner disabled DMs or the send threw, so an
    // unchecked call reports success for a message that was never delivered.
    if (!sent) {
      logger.warn("[Feedback] Owner DM was not delivered.");
      return false;
    }
    return true;
  } catch (error) {
    logger.error(`[Feedback] Failed to DM owner: ${error.message}`);
    return false;
  }
}

async function generateIssueTitle(type, description) {
  if (!llmAvailable()) {
    logger.debug("[Feedback] generateIssueTitle: No OpenAI client available, cannot generate title");
    throw new Error("OpenAI client unavailable for title generation");
  }

  const typeLabel = type === "bug" ? "Bug Report" : "Feature Suggestion";
  logger.debug(`[Feedback] generateIssueTitle: Requesting title for ${typeLabel}, description length: ${description.length}`);

  // Keep the description snippet short so the model isn't overwhelmed and
  // returns a content-less response — 300 chars captures the key context.
  const snippet = description.length > 300 ? description.slice(0, 300) + "…" : description;

  const response = await llm.chat({
    model: CONVO_MODEL,
    messages: [
      {
        role: "user",
        content: `Write a short GitHub issue title (under 80 characters) for this ${typeLabel}. Reply with the title only, no punctuation at the end, no quotes.\n\n${snippet}`,
      },
    ],
    max_tokens: 500,
    temperature: 0.3,
    label: "generateIssueTitle",
    variant: "issue_title",
  });

  const title = response.result.content?.trim();
  if (!title) {
    logger.debug("[Feedback] generateIssueTitle: Empty title from API response.");
    throw new Error("DeepSeek returned empty title content");
  }

  logger.debug(`[Feedback] generateIssueTitle: Generated title: "${title}"`);
  return title.slice(0, 200);
}

async function createGitHubIssue(feedback) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { success: false, error: "GITHUB_TOKEN not configured" };
  if (!GITHUB_REPO_OWNER || !GITHUB_REPO_NAME) return { success: false, error: "GitHub repo not configured" };

  const labels = [
    feedback.type === "bug" ? "bug" : "enhancement",
    ...(feedback.component && feedback.component !== "general" ? [feedback.component] : []),
  ];
  const titlePrefix = feedback.type === "bug" ? "[Bug] " : "[Suggestion] ";
  let issueTitle;
  try {
    issueTitle = await generateIssueTitle(feedback.type, feedback.description);
  } catch (error) {
    logger.error(`[Feedback] Title generation failed, falling back to description: ${error.message}`);
    issueTitle = descriptionFallbackTitle(feedback.description);
  }
  const title = (titlePrefix + issueTitle).trim();

  const body = `## ${feedback.type === "bug" ? "Bug Report" : "Feature Suggestion"}

**Submitted by:** ${feedback.username} (${feedback.userId})
**Source:** ${feedback.guildName}
**Bot Version:** ${require("../../package.json").version}

### Description

${feedback.description}
${feedback.screenshotUrl ? `\n### Screenshot\n\n![screenshot](${feedback.screenshotUrl})\n` : ""}
---
*This issue was automatically created from Discord feedback.*`;

  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "meme-cultist-bot"
        },
        body: JSON.stringify({ title, body, labels })
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    logger.log(`[Feedback] Created GitHub issue #${data.number}: ${data.html_url}`);
    return { success: true, url: data.html_url, number: data.number };
  } catch (error) {
    logger.error(`[Feedback] Failed to create GitHub issue: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Returns false rather than throwing: this runs after the user has already been
// acknowledged, and an unhandled throw here reports nothing to anyone.
async function storeFeedback(feedback) {
  const id = `${Date.now()}-${feedback.userId}`;
  try {
    await feedbackDb.set(id, {
      ...feedback,
      timestamp: Date.now(),
      stored: true
    });
    return true;
  } catch (error) {
    logger.error(`[Feedback] Failed to store feedback ${id}: ${error.message}`);
    return false;
  }
}

function buildOutcomeEmbed(user, client, { type, description, githubResult, ownerNotified, stored }) {
  const body = clamp(description, EMBED_DESCRIPTION_LIMIT);
  const title = `${TYPE_GLYPHS[type]} ${TYPE_LABELS[type]}`;

  if (githubResult?.url) {
    return buildSuccessEmbed(user, client, body)
      .setTitle(title)
      .addFields({ name: "Filed", value: `[Issue #${githubResult.number}](${githubResult.url})`, inline: true });
  }
  if (ownerNotified) {
    return buildSuccessEmbed(user, client, body)
      .setTitle(title)
      .addFields({ name: "Sent", value: "Straight to the owner's DMs.", inline: true });
  }
  if (stored) {
    return buildInfoEmbed(user, client, body, COLORS.warning)
      .setTitle(title)
      .addFields({ name: "Saved", value: `Couldn't reach the owner, so it's on disk. Poke <@${OWNER_ID}> if it's urgent.`, inline: false });
  }
  return buildErrorEmbed(user, client, `${body}\n\n**Nothing saved.** Copy your text above and send it to <@${OWNER_ID}> directly.`)
    .setTitle(title);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("feedback")
    .setDescription("Report a bug, pitch an idea, or just say something."),
  async execute(interaction) {
    // showModal must be the initial response, so nothing may defer before this.
    // Kind and screenshot are collected inside the form rather than as command
    // options, so the whole submission is one step.
    const modalId = `feedback:${interaction.id}`;
    await interaction.showModal(buildFeedbackModal(modalId));

    let submit;
    try {
      submit = await interaction.awaitModalSubmit({
        filter: m => m.customId === modalId && m.user.id === interaction.user.id,
        time: MODAL_TIMEOUT_MS,
      });
    } catch {
      return; // dismissed or timed out — the user chose not to send anything
    }

    await submit.deferReply({ flags: MessageFlags.Ephemeral });

    const type = readFeedbackType(submit);
    const description = composeDescription(readFeedbackValues(submit));
    const user = submit.user;
    const client = submit.client;
    const base = {
      type,
      description,
      username: user.displayName,
      userId: user.id,
      guildName: interaction.guild?.name || "DM",
      screenshotUrl: readScreenshotUrl(submit),
    };

    // Discord's required-field check passes on whitespace, so catch the empty
    // case locally rather than spending two LLM calls to be told it is empty.
    if (!description) {
      await submit.editReply({
        embeds: [buildErrorEmbed(user, client, "That came through blank. Run it again and put something in the box.")
          .setTitle("Nothing to send")],
      });
      return;
    }

    const validation = await validateFeedback(type, description, user.displayName);

    if (!validation.valid) {
      const reason = clamp((validation.reason || "").trim(), 500) || "That didn't read as real feedback.";
      // The draft is echoed back because the modal's contents are gone the moment
      // it closes, and retyping from memory is how a rejection becomes an exit.
      await submit.editReply({
        embeds: [buildErrorEmbed(user, client, `${reason}\n\nIf that's wrong, ping <@${OWNER_ID}> — better it gets heard twice than not at all.\n\n**Your draft, so you don't lose it:**\n>>> ${clamp(description, 3000)}`)
          .setTitle("That didn't go through")],
      });
      logger.log(`[Feedback] Rejected (${validation.category}) from ${user.displayName}: ${description.slice(0, 50)}...`);
      return;
    }

    await submit.editReply({
      embeds: [buildSuccessEmbed(user, client, clamp(description, EMBED_DESCRIPTION_LIMIT))
        .setTitle(`${TYPE_GLYPHS[type]} ${TYPE_LABELS[type]}`)
        .addFields({ name: "Status", value: "Sending it on…", inline: true })],
    });

    let githubResult = null;
    if (type === "bug" || type === "suggestion") {
      githubResult = await createGitHubIssue({ ...base, component: validation.component });
    }

    const ownerNotified = await notifyOwner(client, {
      ...base,
      category: validation.category,
      component: validation.component,
      validationReason: validation.reason,
      avatarURL: user.displayAvatarURL({ dynamic: true }),
      issueUrl: githubResult?.url || null,
      githubError: githubResult?.error || null
    });

    const stored = await storeFeedback({
      ...base,
      category: validation.category,
      component: validation.component,
      issueUrl: githubResult?.url || null,
      githubError: githubResult?.error || null,
      ownerNotified,
      valid: true
    });

    // The confirmation above is provisional; this one reports what actually
    // happened, because every delivery path here can fail silently.
    await submit.editReply({ embeds: [buildOutcomeEmbed(user, client, { type, description, githubResult, ownerNotified, stored })] });

    logger.log(`[Feedback] ${TYPE_LABELS[type]} (${validation.category}) from ${user.displayName}: ${description.slice(0, 100)}${description.length > 100 ? "..." : ""}`);
  }
};