// Not suppressible: no-lint-suppression guards this rule. Shorten instead.

const DIRECTIVE = /^\s*(eslint|globals?|exported|istanbul|c8|jshint|jslint)\b/;

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Confirm that a comment block longer than one line is necessary",
    },
    schema: [],
    messages: {
      multiline: "Comment block spans {{lines}} lines. Confirm the extra lines are necessary — prefer one line, or none. If the code is decipherable alone, remove the comment/",
    },
  },

  create(context) {
    const sourceCode = context.getSourceCode();

    function startsItsOwnLine(comment) {
      const line = sourceCode.lines[comment.loc.start.line - 1] ?? "";
      return line.slice(0, comment.loc.start.column).trim() === "";
    }

    function report(node, startLoc, endLoc, lines) {
      context.report({
        node,
        loc: { start: startLoc, end: endLoc },
        messageId: "multiline",
        data: { lines },
      });
    }

    return {
      Program(node) {
        const comments = sourceCode.getAllComments();
        let group = [];

        function flushGroup() {
          if (group.length > 1) {
            report(node, group[0].loc.start, group[group.length - 1].loc.end, group.length);
          }
          group = [];
        }

        for (const comment of comments) {
          if (DIRECTIVE.test(comment.value)) {
            flushGroup();
            continue;
          }

          if (comment.type === "Block") {
            flushGroup();
            const lines = comment.loc.end.line - comment.loc.start.line + 1;
            if (lines > 1) report(node, comment.loc.start, comment.loc.end, lines);
            continue;
          }

          // Trailing remarks on consecutive statements are not a paragraph.
          if (!startsItsOwnLine(comment)) {
            flushGroup();
            continue;
          }

          const previous = group[group.length - 1];
          if (previous && comment.loc.start.line !== previous.loc.end.line + 1) flushGroup();
          group.push(comment);
        }

        flushGroup();
      },
    };
  },
};
