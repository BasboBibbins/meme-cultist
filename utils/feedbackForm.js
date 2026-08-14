const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");

const TYPE_LABELS = { bug: "Bug Report", suggestion: "Feature Suggestion", general: "General Feedback" };
const TYPE_GLYPHS = { bug: "🐛", suggestion: "💡", general: "💬" };

// Discord rejects an embed description over 4096; per-field caps are sized so
// the composed description lands well under it even when every field is full.
const EMBED_DESCRIPTION_LIMIT = 4000;

const FEEDBACK_FIELDS = {
  bug: [
    { id: "what", label: "What happened?", max: 1500, required: true, placeholder: "What went wrong, and where?" },
    { id: "expected", label: "What did you expect instead?", max: 800, required: false },
    { id: "repro", label: "How do we make it happen again?", max: 800, required: false, placeholder: "Which command, which game, which theme?" },
  ],
  suggestion: [
    { id: "what", label: "What should it do?", max: 2000, required: true },
    { id: "why", label: "Why would that be better?", max: 1000, required: false },
  ],
  general: [
    { id: "what", label: "What's on your mind?", max: 3000, required: true },
  ],
};

function buildFeedbackModal(type, modalId) {
  const modal = new ModalBuilder().setCustomId(modalId).setTitle(TYPE_LABELS[type]);
  for (const spec of FEEDBACK_FIELDS[type]) {
    const input = new TextInputBuilder()
      .setCustomId(spec.id)
      .setLabel(spec.label)
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(spec.max)
      .setRequired(spec.required);
    if (spec.placeholder) input.setPlaceholder(spec.placeholder);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

// A single-field type reads as plain prose; multi-field types keep their labels
// so the owner and the GitHub issue inherit the structure the user filled in.
function composeDescription(type, values) {
  const specs = FEEDBACK_FIELDS[type];
  const parts = [];
  for (const spec of specs) {
    const value = (values[spec.id] || "").trim();
    if (!value) continue;
    parts.push(specs.length === 1 ? value : `**${spec.label}**\n${value}`);
  }
  return parts.join("\n\n");
}

function clamp(text, limit) {
  if (!text || text.length <= limit) return text;
  return text.slice(0, limit - 1) + "…";
}

// Extract the first complete sentence from a description and cap it at maxLen
// characters on a word boundary. Used as a fallback when the LLM returns empty.
function descriptionFallbackTitle(description, maxLen = 100) {
  // A description opening with punctuation ("...crashes on load") splits to an
  // empty first segment, which would title the issue with just its prefix.
  const first = (description.split(/[.!?\n]/).find(part => part.trim()) || description).trim();
  if (first.length <= maxLen) return first;
  const cut = first.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + "…";
}

module.exports = {
  TYPE_LABELS,
  TYPE_GLYPHS,
  EMBED_DESCRIPTION_LIMIT,
  FEEDBACK_FIELDS,
  buildFeedbackModal,
  composeDescription,
  clamp,
  descriptionFallbackTitle,
};
