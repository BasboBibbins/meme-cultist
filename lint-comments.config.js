// Separate from .eslintrc.js because this rule needs --rulesdir, which a bare `eslint` run (IDE) does not pass.

module.exports = {
  extends: "./.eslintrc.js",
  rules: {
    "no-multiline-comments": "warn",
  },
};
