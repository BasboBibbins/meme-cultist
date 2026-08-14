// Guards the comment rules against being disabled instead of obeyed.

const SUPPRESSION = /^\s*eslint-disable(?:-next-line|-line)?\s+(.+)$/;
const GUARDED = new Set(["no-multiline-comments", "no-em-dash"]);

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Forbid suppressing the comment style rules",
    },
    schema: [],
    messages: {
      suppressed: "Do not disable {{rule}}. Shorten the comment to one line, or delete it.",
    },
  },

  create(context) {
    const sourceCode = context.getSourceCode();

    return {
      Program(node) {
        for (const comment of sourceCode.getAllComments()) {
          const match = SUPPRESSION.exec(comment.value);
          if (!match) continue;

          for (const rule of match[1].split(",").map(r => r.trim().replace(/--.*$/, "").trim())) {
            if (!GUARDED.has(rule)) continue;
            context.report({
              node,
              loc: comment.loc,
              messageId: "suppressed",
              data: { rule },
            });
          }
        }
      },
    };
  },
};
