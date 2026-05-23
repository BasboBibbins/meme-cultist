const { SlashCommandBuilder } = require("discord.js");
const { QuickDB } = require("quick.db");
const logger = require("../../utils/logger");
const llm = require("../../utils/llm");
const { buildBaseEmbed, buildErrorEmbed, buildInfoEmbed, COLORS } = require("../../utils/embeds");
const { sendDM } = require("../../utils/dm");
const { chatWithSchema } = require("../../utils/schemas");
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

async function validateFeedback(type, description, username) {
  if (!llmAvailable()) return { valid: true, reason: "API unavailable", category: "unknown" };

  const typeLabels = { bug: "Bug Report", suggestion: "Feature Suggestion", general: "General Feedback" };

  const prompt = `You are a content moderator. Analyze this feedback and respond with ONLY valid JSON.

Feedback Type: ${typeLabels[type]}
From User: ${username}
Content: "${description}"

Classify validity:
- legitimate: genuine bug reports, feature suggestions, or constructive feedback.
- spam: repetitive, advertisements, gibberish.
- abusive: harassment, threats, hate speech.
- nonsense: random characters, meaningless.
- empty: < 5 characters of content.

Classify component (what part of the bot this relates to):
- chatbot: AI chatbot, memory, personas, knowledge base, reminders, chat behaviour.
- games: casino games (craps, duel, slots, blackjack, poker, roulette, race, shop).
- themes: visual appearance, cosmetics, card art, table colours.
- general: bot-wide issues, currency/economy, commands not covered above, or unclear.`;

  try {
    const response = await chatWithSchema({
      schemaName: "feedback-validation",
      model: CONVO_MODEL,
      messages: [
        { role: "system", content: "You respond only with valid JSON." },
        { role: "user", content: prompt },
      ],
      max_tokens: 150,
      temperature: 0.1,
      label: "validateFeedback",
      variant: "validate_feedback",
    });

    if (response.validated && typeof response.validated.valid === "boolean") {
      return response.validated;
    }
    logger.warn(`[Feedback] Schema validation failed: ${response.schemaError}. Falling back to legacy parser.`);
    let content = response.result.content?.trim();
    if (!content) return { valid: false, reason: "Empty response", category: "unknown" };
    content = cleanMarkdownCode(content);
    return JSON.parse(content);
  } catch (error) {
    logger.error(`[Feedback] Validation error: ${error.message}`);
    return { valid: false, reason: "Validation failed", category: "error" };
  }
}

async function notifyOwner(client, feedback) {
  try {
    const owner = await client.users.fetch(OWNER_ID);
    if (!owner) {
      logger.error("[Feedback] Could not fetch owner");
      return false;
    }

    const typeLabels = {
      bug: "🐛 Bug Report",
      suggestion: "💡 Feature Suggestion",
      general: "💬 General Feedback"
    };

    const fakeUser = { displayName: feedback.username, displayAvatarURL: () => feedback.avatarURL };
    const color = feedback.type === "bug" ? COLORS.error : feedback.type === "suggestion" ? COLORS.success : COLORS.primary;
    const embed = buildBaseEmbed(fakeUser, client)
      .setAuthor({ name: `New Feedback from ${feedback.username}`, iconURL: feedback.avatarURL })
      .setTitle(typeLabels[feedback.type])
      .setDescription(feedback.description)
      .setColor(color)
      .addFields(
        { name: "User", value: `${feedback.username} (${feedback.userId})`, inline: true },
        { name: "Category", value: feedback.category, inline: true },
        { name: "Component", value: feedback.component || "general", inline: true },
        { name: "Guild", value: feedback.guildName || "Unknown", inline: true }
      );

    if (feedback.type === "bug" || feedback.type === "suggestion") {
      embed.addFields({
        name: "GitHub Issue",
        value: feedback.issueUrl || `Failed: ${feedback.githubError || "Unknown error"}`
      });
    }

    await sendDM(owner, { embeds: [embed] });
    return true;
  } catch (error) {
    logger.error(`[Feedback] Failed to DM owner: ${error.message}`);
    return false;
  }
}

// Extract the first complete sentence from a description and cap it at maxLen
// characters on a word boundary. Used as a fallback when the LLM returns empty.
function descriptionFallbackTitle(description, maxLen = 100) {
  const first = description.split(/[.!?\n]/)[0].trim();
  if (first.length <= maxLen) return first;
  const cut = first.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + "…";
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

### Description

${feedback.description}

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

async function storeFeedback(feedback) {
  const id = `${Date.now()}-${feedback.userId}`;
  await feedbackDb.set(id, {
    ...feedback,
    timestamp: Date.now(),
    stored: true
  });
  return id;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("feedback")
    .setDescription("Submit feedback, bug reports, or feature suggestions for the bot.")
    .addStringOption(option =>
      option.setName("type")
        .setDescription("The type of feedback")
        .setRequired(true)
        .addChoices(
          { name: "Bug Report", value: "bug" },
          { name: "Feature Suggestion", value: "suggestion" },
          { name: "General Feedback", value: "general" }
        ))
    .addStringOption(option =>
      option.setName("description")
        .setDescription("Describe your feedback in detail")
        .setRequired(true)),
  async execute(interaction) {
    const type = interaction.options.getString("type");
    const description = interaction.options.getString("description");
    const typeLabels = { bug: "Bug Report", suggestion: "Feature Suggestion", general: "General Feedback" };

    await interaction.deferReply({ ephemeral: true });

    const validation = await validateFeedback(type, description, interaction.user.displayName);

    if (!validation.valid) {
      await interaction.editReply({
        embeds: [buildErrorEmbed(interaction.user, interaction.client, `Your feedback was flagged as **${validation.category}**.\n\nReason: ${validation.reason}`)
          .setAuthor({ name: "Feedback Rejected", iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
          .setTitle("Unable to Submit Feedback")],
      });
      logger.log(`[Feedback] Rejected (${validation.category}) from ${interaction.user.displayName}: ${description.slice(0, 50)}...`);
      return;
    }

    await interaction.editReply({
      embeds: [buildInfoEmbed(interaction.user, interaction.client, description)
        .setAuthor({ name: "Feedback Received", iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
        .setTitle(typeLabels[type])
        .addFields({ name: "Status", value: "Pending review", inline: true })
        .setFooter({ text: `From ${interaction.user.displayName} (${interaction.user.id})` })],
    });

    let githubResult = null;
    if (type === "bug" || type === "suggestion") {
      githubResult = await createGitHubIssue({
        type,
        component: validation.component,
        description,
        username: interaction.user.displayName,
        userId: interaction.user.id,
        guildName: interaction.guild?.name || "DM"
      });
    }

    await notifyOwner(interaction.client, {
      type,
      category: validation.category,
      component: validation.component,
      description,
      username: interaction.user.displayName,
      userId: interaction.user.id,
      avatarURL: interaction.user.displayAvatarURL({ dynamic: true }),
      guildName: interaction.guild?.name || "DM",
      issueUrl: githubResult?.url || null,
      githubError: githubResult?.error || null
    });

    await storeFeedback({
      type,
      category: validation.category,
      component: validation.component,
      description,
      username: interaction.user.displayName,
      userId: interaction.user.id,
      guildName: interaction.guild?.name || "DM",
      issueUrl: githubResult?.url || null,
      valid: true
    });

    logger.log(`[Feedback] ${typeLabels[type]} (${validation.category}) from ${interaction.user.displayName}: ${description.slice(0, 100)}${description.length > 100 ? "..." : ""}`);
  }
};