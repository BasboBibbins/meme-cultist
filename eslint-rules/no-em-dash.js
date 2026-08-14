// Not suppressible: no-lint-suppression guards this rule.

const EM_DASH = "—";

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Ban em dashes in comments and strings",
    },
    schema: [],
    messages: {
      emDash: "Em dash in this {{kind}}. Reword it. Use a comma, a colon, parentheses, or a separate sentence.",
    },
  },

  create(context) {
    const sourceCode = context.getSourceCode();

    function reportOccurrences(node, text, offset, kind) {
      let index = text.indexOf(EM_DASH);
      while (index !== -1) {
        const start = offset + index;
        context.report({
          node,
          loc: {
            start: sourceCode.getLocFromIndex(start),
            end: sourceCode.getLocFromIndex(start + EM_DASH.length),
          },
          messageId: "emDash",
          data: { kind },
        });
        index = text.indexOf(EM_DASH, index + EM_DASH.length);
      }
    }

    function checkNode(node, kind) {
      const [start] = node.range;
      reportOccurrences(node, sourceCode.getText(node), start, kind);
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") checkNode(node, "string");
      },

      TemplateElement(node) {
        checkNode(node, "template string");
      },

      Program(node) {
        for (const comment of sourceCode.getAllComments()) {
          reportOccurrences(node, comment.value, comment.range[0] + 2, "comment");
        }
      },
    };
  },
};
