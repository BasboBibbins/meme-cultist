const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { OpenAIApi, Configuration } = require("openai");
const { QuickDB } = require("quick.db");
const logger = require("../../utils/logger");
const { randomHexColor } = require("../../utils/randomcolor");
const { CHATBOT_LOCAL, OWNER_ID, GITHUB_REPO_OWNER, GITHUB_REPO_NAME } = require("../../config.js");

const feedbackDb = new QuickDB({ filePath: `./db/feedback.sqlite` });

let openaiClient = null;
function getFeedbackClient() {
    if (!openaiClient) {
        const key = process.env.OPENAI_API_KEY;
        if (!key) {
            logger.error("[Feedback] OPENAI_API_KEY not found in environment");
            return null;
        }
        const configuration = new Configuration({
            apiKey: key,
            basePath: CHATBOT_LOCAL ? "http://127.0.0.1:3000/v1/" : "https://api.deepseek.com"
        });
        openaiClient = new OpenAIApi(configuration);
    }
    return openaiClient;
}

async function validateFeedback(type, description, username) {
    const openai = getFeedbackClient();
    if (!openai) return { valid: true, reason: "API unavailable", category: "unknown" };

    const typeLabels = { bug: 'Bug Report', suggestion: 'Feature Suggestion', general: 'General Feedback' };

    const prompt = `You are a content moderator. Analyze this feedback and respond with ONLY valid JSON (no markdown):

Feedback Type: ${typeLabels[type]}
From User: ${username}
Content: "${description}"

{"valid": boolean, "reason": "brief explanation if invalid", "category": "legitimate"|"spam"|"abusive"|"nonsense"|"empty"}

Legitimate: genuine bug reports, feature suggestions, or constructive feedback.
Spam: repetitive, advertisements, gibberish.
Abusive: harassment, threats, hate speech.
Nonsense: random characters, meaningless.
Empty: < 5 characters of content.`;

    try {
        const response = await openai.createChatCompletion({
            model: "deepseek-chat",
            messages: [
                { role: "system", content: "You respond only with valid JSON." },
                { role: "user", content: prompt }
            ],
            max_tokens: 150,
            temperature: 0.1
        });

        const content = response.data.choices[0]?.message?.content?.trim();
        if (!content) return { valid: true, reason: "Empty response", category: "unknown" };
        return JSON.parse(content);
    } catch (error) {
        logger.error(`[Feedback] Validation error: ${error.message}`);
        return { valid: true, reason: "Validation failed", category: "error" };
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
            bug: '🐛 Bug Report',
            suggestion: '💡 Feature Suggestion',
            general: '💬 General Feedback'
        };

        const embed = new EmbedBuilder()
            .setAuthor({ name: `New Feedback from ${feedback.username}`, iconURL: feedback.avatarURL })
            .setTitle(typeLabels[feedback.type])
            .setDescription(feedback.description)
            .setColor(feedback.type === 'bug' ? '#ff4444' : feedback.type === 'suggestion' ? '#44ff44' : '#4444ff')
            .addFields(
                { name: 'User', value: `${feedback.username} (${feedback.userId})`, inline: true },
                { name: 'Category', value: feedback.category, inline: true },
                { name: 'Guild', value: feedback.guildName || 'Unknown', inline: true }
            )
            .setTimestamp();

        if (feedback.type === 'bug' || feedback.type === 'suggestion') {
            embed.addFields({
                name: 'GitHub Issue',
                value: feedback.issueUrl || `Failed: ${feedback.githubError || 'Unknown error'}`
            });
        }

        await owner.send({ embeds: [embed] });
        return true;
    } catch (error) {
        logger.error(`[Feedback] Failed to DM owner: ${error.message}`);
        return false;
    }
}

async function generateIssueTitle(type, description) {
    const openai = getFeedbackClient();
    if (!openai) {
        logger.debug("[Feedback] generateIssueTitle: No OpenAI client available, cannot generate title");
        throw new Error("OpenAI client unavailable for title generation");
    }

    const typeLabel = type === 'bug' ? 'Bug Report' : 'Feature Suggestion';
    logger.debug(`[Feedback] generateIssueTitle: Requesting title for ${typeLabel}, description length: ${description.length}`);

    const response = await openai.createChatCompletion({
        model: "deepseek-chat",
        messages: [
            { role: "system", content: "You generate concise GitHub issue titles. Respond with ONLY the title text, no quotes or extra formatting." },
            { role: "user", content: `Generate a short, descriptive GitHub issue title for this ${typeLabel}:\n\n"${description}"` }
        ],
        max_tokens: 60,
        temperature: 0.3
    });

    logger.debug(`[Feedback] generateIssueTitle: Response status: ${response.status}`);
    logger.debug(`[Feedback] generateIssueTitle: Response choices: ${JSON.stringify(response.data?.choices)}`);

    const title = response.data?.choices?.[0]?.message?.content?.trim();
    if (!title) {
        logger.debug(`[Feedback] generateIssueTitle: Empty title from API response. Full response.data: ${JSON.stringify(response.data)}`);
        throw new Error("DeepSeek returned empty title content");
    }

    logger.debug(`[Feedback] generateIssueTitle: Generated title: "${title}"`);
    return title.slice(0, 200);
}

async function createGitHubIssue(feedback) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return { success: false, error: "GITHUB_TOKEN not configured" };
    if (!GITHUB_REPO_OWNER || !GITHUB_REPO_NAME) return { success: false, error: "GitHub repo not configured" };

    const labels = feedback.type === 'bug' ? ['bug'] : ['enhancement'];
    const titlePrefix = feedback.type === 'bug' ? '[Bug] ' : '[Suggestion] ';
    let issueTitle;
    try {
        issueTitle = await generateIssueTitle(feedback.type, feedback.description);
    } catch (error) {
        logger.error(`[Feedback] Title generation failed, falling back to description: ${error.message}`);
        issueTitle = feedback.description.slice(0, 200);
    }
    const title = (titlePrefix + issueTitle).trim();

    const body = `## ${feedback.type === 'bug' ? 'Bug Report' : 'Feature Suggestion'}

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
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                    'User-Agent': 'meme-cultist-bot'
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
            option.setName('type')
                .setDescription('The type of feedback')
                .setRequired(true)
                .addChoices(
                    { name: 'Bug Report', value: 'bug' },
                    { name: 'Feature Suggestion', value: 'suggestion' },
                    { name: 'General Feedback', value: 'general' }
                ))
        .addStringOption(option =>
            option.setName('description')
                .setDescription('Describe your feedback in detail')
                .setRequired(true)),
    async execute(interaction) {
        const type = interaction.options.getString('type');
        const description = interaction.options.getString('description');
        const typeLabels = { bug: 'Bug Report', suggestion: 'Feature Suggestion', general: 'General Feedback' };

        await interaction.deferReply({ ephemeral: true });

        const validation = await validateFeedback(type, description, interaction.user.displayName);

        if (!validation.valid) {
            const rejectEmbed = new EmbedBuilder()
                .setAuthor({ name: `Feedback Rejected`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
                .setTitle('Unable to Submit Feedback')
                .setDescription(`Your feedback was flagged as **${validation.category}**.\n\nReason: ${validation.reason}`)
                .setColor('#ff4444')
                .setTimestamp();

            await interaction.editReply({ embeds: [rejectEmbed] });
            logger.log(`[Feedback] Rejected (${validation.category}) from ${interaction.user.displayName}: ${description.slice(0, 50)}...`);
            return;
        }

        const embed = new EmbedBuilder()
            .setAuthor({ name: `Feedback Received`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
            .setTitle(typeLabels[type])
            .setDescription(description)
            .setColor(randomHexColor())
            .addFields({ name: 'Status', value: 'Pending review', inline: true })
            .setFooter({ text: `From ${interaction.user.displayName} (${interaction.user.id})` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        let githubResult = null;
        if (type === 'bug' || type === 'suggestion') {
            githubResult = await createGitHubIssue({
                type,
                description,
                username: interaction.user.displayName,
                userId: interaction.user.id,
                guildName: interaction.guild?.name || 'DM'
            });
        }

        await notifyOwner(interaction.client, {
            type,
            category: validation.category,
            description,
            username: interaction.user.displayName,
            userId: interaction.user.id,
            avatarURL: interaction.user.displayAvatarURL({ dynamic: true }),
            guildName: interaction.guild?.name || 'DM',
            issueUrl: githubResult?.url || null,
            githubError: githubResult?.error || null
        });

        await storeFeedback({
            type,
            category: validation.category,
            description,
            username: interaction.user.displayName,
            userId: interaction.user.id,
            guildName: interaction.guild?.name || 'DM',
            issueUrl: githubResult?.url || null,
            valid: true
        });

        logger.log(`[Feedback] ${typeLabels[type]} (${validation.category}) from ${interaction.user.displayName}: ${description.slice(0, 100)}${description.length > 100 ? '...' : ''}`);
    }
};