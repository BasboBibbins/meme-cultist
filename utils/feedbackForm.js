const {
  ModalBuilder, LabelBuilder, TextDisplayBuilder, TextInputBuilder,
  TextInputStyle, RadioGroupBuilder, FileUploadBuilder,
} = require("discord.js");

const TYPE_LABELS = { bug: "Bug Report", suggestion: "Feature Suggestion", general: "General Feedback" };
const TYPE_GLYPHS = { bug: "🐛", suggestion: "💡", general: "💬" };
const DEFAULT_TYPE = "general";

// Discord rejects an embed description over 4096; the field caps below are sized
// so a fully-filled form lands under this even with the labels prepended.
const EMBED_DESCRIPTION_LIMIT = 4000;

const TYPE_FIELD = "kind";
const SCREENSHOT_FIELD = "screenshot";

const FEEDBACK_TYPES = [
  { value: "bug", label: "Something's broken", description: "A bug report" },
  { value: "suggestion", label: "I have an idea", description: "A feature suggestion" },
  { value: "general", label: "Just saying something", description: "Anything else" },
];

// The modal is built before the user picks a kind, so one field set serves all
// three — the prompts stay neutral and the helper text covers the bug case.
const FEEDBACK_FIELDS = [
  {
    id: "what",
    label: "What's going on?",
    description: "The more detail the better — where it happened and what you saw.",
    placeholder: "Tell it like you'd tell a friend.",
    max: 2500,
    required: true,
  },
  {
    id: "extra",
    label: "Anything else worth knowing?",
    description: "For a bug: what you expected instead, and how to make it happen again.",
    max: 1200,
    required: false,
  },
];

const DISCLOSURE = "-# Bug reports and ideas open a **public GitHub issue** with your display name on it.";

function buildFeedbackModal(modalId) {
  const modal = new ModalBuilder().setCustomId(modalId).setTitle("Send Feedback");

  modal.addTextDisplayComponents(new TextDisplayBuilder().setContent(DISCLOSURE));

  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel("What kind?")
      .setRadioGroupComponent(
        new RadioGroupBuilder()
          .setCustomId(TYPE_FIELD)
          .setRequired(true)
          .addOptions(...FEEDBACK_TYPES)
      )
  );

  for (const spec of FEEDBACK_FIELDS) {
    const input = new TextInputBuilder()
      .setCustomId(spec.id)
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(spec.max)
      .setRequired(spec.required);
    if (spec.placeholder) input.setPlaceholder(spec.placeholder);

    const label = new LabelBuilder().setLabel(spec.label).setTextInputComponent(input);
    if (spec.description) label.setDescription(spec.description);
    modal.addLabelComponents(label);
  }

  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel("Screenshot")
      .setDescription("Optional, but worth a paragraph on a broken render.")
      .setFileUploadComponent(
        new FileUploadBuilder()
          .setCustomId(SCREENSHOT_FIELD)
          .setRequired(false)
          .setMaxValues(1)
      )
  );

  return modal;
}

// An unrecognised value would flow into TYPE_LABELS lookups and GitHub labels,
// so anything unexpected collapses to the neutral kind.
function readFeedbackType(submit) {
  const value = submit.fields.getRadioGroup(TYPE_FIELD);
  return Object.prototype.hasOwnProperty.call(TYPE_LABELS, value) ? value : DEFAULT_TYPE;
}

function readFeedbackValues(submit) {
  const values = {};
  for (const spec of FEEDBACK_FIELDS) values[spec.id] = submit.fields.getTextInputValue(spec.id);
  return values;
}

function readScreenshotUrl(submit) {
  return submit.fields.getUploadedFiles(SCREENSHOT_FIELD)?.first()?.url || null;
}

// The first answer carries the report, so it reads as plain prose; a filled-in
// second box is labelled so the owner and the GitHub issue keep the structure.
function composeDescription(values) {
  const parts = [];
  for (const spec of FEEDBACK_FIELDS) {
    const value = (values[spec.id] || "").trim();
    if (!value) continue;
    parts.push(spec === FEEDBACK_FIELDS[0] ? value : `**${spec.label}**\n${value}`);
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
  DEFAULT_TYPE,
  EMBED_DESCRIPTION_LIMIT,
  TYPE_FIELD,
  SCREENSHOT_FIELD,
  FEEDBACK_TYPES,
  FEEDBACK_FIELDS,
  buildFeedbackModal,
  readFeedbackType,
  readFeedbackValues,
  readScreenshotUrl,
  composeDescription,
  clamp,
  descriptionFallbackTitle,
};
