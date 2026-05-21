module.exports = {
  testEnvironment: "node",
  // test/llm/ uses its own custom runner (node test/llm/runner.js) — exclude it here.
  testMatch: [
    "**/test/unit/**/*.test.js",
    "**/test/canvas/**/*.test.js",
  ],
  verbose: true,
};
