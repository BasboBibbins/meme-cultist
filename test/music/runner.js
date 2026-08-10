const path = require("path");
const fs = require("fs");

// Music integration runner — hits real provider endpoints, so it stays outside Jest and CI. Usage: node test/music/runner.js [suite]

const ORDER = ["environment", "extractors", "search", "stream", "legacy"];

// youtubei.js narrates parser mismatches for tracks it still returns fine; unfiltered they bury the results.
function quietYoutubeiNoise() {
  const realErr = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    const s = String(chunk);
    if (s.includes("[YOUTUBEJS]") && !process.env.MUSIC_TEST_VERBOSE) return true;
    return realErr(chunk, ...rest);
  };
}

function statusIcon(status) {
  return { OK: "  OK  ", FAIL: " FAIL ", WARN: " WARN ", SKIP: " SKIP " }[status] || status;
}

function printMatrix(capabilities) {
  console.log("\n============================================================");
  console.log("MUSIC CAPABILITY MATRIX");
  console.log("============================================================");
  const areas = [...new Set(capabilities.map(c => c.area))];
  for (const area of areas) {
    console.log(`\n${area.toUpperCase()}`);
    for (const c of capabilities.filter(x => x.area === area)) {
      console.log(`  [${statusIcon(c.status)}] ${c.name.padEnd(28)} ${c.detail}`);
    }
  }
  const broken = capabilities.filter(c => c.status === "FAIL");
  console.log("\n------------------------------------------------------------");
  if (broken.length === 0) {
    console.log("Everything probed is working.");
  } else {
    console.log(`${broken.length} capability/capabilities not working:`);
    for (const c of broken) console.log(`  - ${c.area}/${c.name}: ${c.detail}`);
  }
  console.log("============================================================");
}

async function run() {
  quietYoutubeiNoise();

  const only = process.argv[2];
  const dir = __dirname;
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith(".test.js"))
    .filter(f => !only || f === `${only}.test.js`)
    .sort((a, b) => ORDER.indexOf(a.replace(".test.js", "")) - ORDER.indexOf(b.replace(".test.js", "")));

  if (files.length === 0) {
    console.error(`No suite matched "${only}". Available: ${ORDER.join(", ")}`);
    process.exit(1);
  }

  let totalPassed = 0;
  let totalFailed = 0;

  for (const file of files) {
    console.log(`\n--- ${file} ---`);
    try {
      const mod = require(path.join(dir, file));
      if (typeof mod.run !== "function") {
        console.log("  (no exported run() — skipped)");
        continue;
      }
      const { passed, failed } = await mod.run();
      totalPassed = passed;
      totalFailed = failed;
    } catch (err) {
      console.error(`  SUITE ERROR: ${err.message}`);
      totalFailed += 1;
    }
  }

  const { capabilities } = require("./harness");
  printMatrix(capabilities);

  console.log(`\nTotal: ${totalPassed} passed, ${totalFailed} failed`);
  process.exit(totalFailed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error("Runner error:", err);
  process.exit(1);
});
