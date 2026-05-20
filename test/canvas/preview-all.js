/**
 * Batch runner for all canvas preview scripts.
 * Clears tmp/canvas/, then executes each game renderer sequentially.
 * Usage: node test/canvas/preview-all.js
 *        npm run preview:canvas
 */
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const SCRIPTS = [
    "preview-blackjack.js",
    "preview-craps.js",
    "preview-duel.js",
    "preview-poker.js",
    "preview-roulette.js",
    "preview-slots.js",
];

const DIR = __dirname;
const OUT_DIR = path.join(DIR, "../../tmp/canvas");

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const f of fs.readdirSync(OUT_DIR)) {
    fs.rmSync(path.join(OUT_DIR, f), { recursive: true, force: true });
}
console.log(`Cleared ${OUT_DIR}`);

const totalStart = Date.now();
let passed = 0;
let failed = 0;

for (const script of SCRIPTS) {
    const label = script.replace(".js", "");
    process.stdout.write(`\n[${label}]\n`);

    const start = Date.now();
    const result = spawnSync(process.execPath, [path.join(DIR, script)], {
        stdio: "inherit",
        cwd: path.join(DIR, "../.."),
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(2);

    if (result.status === 0) {
        console.log(`  done in ${elapsed}s`);
        passed++;
    } else {
        console.error(`  FAILED (exit ${result.status}) after ${elapsed}s`);
        failed++;
    }
}

const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(2);
console.log(`\n${passed + failed} scripts — ${passed} ok, ${failed} failed — ${totalElapsed}s total`);
if (failed > 0) process.exit(1);
