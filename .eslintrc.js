module.exports = {
  env: {
    node: true,
    es2021: true,
  },
  parserOptions: {
    ecmaVersion: 2021,
  },
  rules: {
    // Style — matches documented conventions
    "quotes": ["error", "double", { "avoidEscape": true }],
    "indent": ["error", 2, { "SwitchCase": 1 }],
    "semi": ["error", "always"],

    // Code quality
    "no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
    "no-undef": "error",
    "eqeqeq": ["error", "always", { "null": "ignore" }],
    "no-var": "error",
    "prefer-const": "warn",
    "no-global-assign": "error",
    "no-duplicate-case": "error",
    "no-restricted-syntax": ["warn", {
      selector: "NewExpression[callee.name='EmbedBuilder']",
      message: "Use a factory from utils/embeds.js (buildErrorEmbed, buildSuccessEmbed, buildInfoEmbed, buildBaseEmbed) instead of constructing EmbedBuilder directly.",
    }],
  },
  overrides: [
    {
      files: ["test/unit/**/*.test.js", "test/canvas/**/*.test.js"],
      env: { jest: true },
    },
    {
      // embeds.js is the factory implementation — raw EmbedBuilder is intentional here.
      files: ["utils/embeds.js"],
      rules: { "no-restricted-syntax": "off" },
    },
  ],
};
