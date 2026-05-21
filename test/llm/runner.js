const path = require("path");
const fs = require("fs");

// Minimal test runner for standalone scripts.
// Usage: node test/llm/runner.js
// Discovers all *.test.js files in test/llm/ and runs them sequentially.

async function run() {
  const dir = path.join(__dirname);
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith(".test.js"))
    .sort();

  let totalPassed = 0;
  let totalFailed = 0;

  for (const file of files) {
    const fullPath = path.join(dir, file);
    console.log(`\n--- ${file} ---`);
    try {
      delete require.cache[require.resolve(fullPath)];
      const mod = require(fullPath);
      if (typeof mod.run === "function") {
        const { passed, failed } = await mod.run();
        totalPassed += passed;
        totalFailed += failed;
      } else {
        console.log("  (no exported run() function — skipped)");
      }
    } catch (err) {
      console.error(`  SUITE ERROR: ${err.message}`);
      totalFailed += 1;
    }
  }

  console.log("\n============================");
  console.log(`Total: ${totalPassed} passed, ${totalFailed} failed`);
  console.log("============================");
  process.exit(totalFailed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error("Runner error:", err);
  process.exit(1);
});
