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
  },
};
