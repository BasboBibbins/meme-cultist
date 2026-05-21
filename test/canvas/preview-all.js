/**
 * Batch runner for all canvas preview scripts.
 * Usage: node test/canvas/preview-all.js
 *        npm run preview:canvas
 *        npm run preview:canvas -- --theme neon
 *
 * Without --theme: clears tmp/canvas/ and renders the default theme batch.
 * With --theme <id>: renders only that theme into tmp/canvas/<id>/, preserving
 * other theme directories. Exits 1 if the theme ID is not registered.
 */
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const { themes } = require("../../themes/configs/index");

const SCRIPTS = [
  "preview-blackjack.js",
  "preview-craps.js",
  "preview-duel.js",
  "preview-poker.js",
  "preview-roulette.js",
  "preview-slots.js",
];

const DIR = __dirname;
const CANVAS_ROOT = path.join(DIR, "../../tmp/canvas");

const extraArgs = process.argv.slice(2);
const themeArgIdx = extraArgs.indexOf("--theme");
const themeArg = themeArgIdx !== -1 ? extraArgs[themeArgIdx + 1] || null : null;

if (themeArg) {
  if (!themes[themeArg]) {
    console.error(`Error: unknown theme "${themeArg}"`);
    process.exit(1);
  }
  const themeDir = path.join(CANVAS_ROOT, themeArg);
  fs.mkdirSync(themeDir, { recursive: true });
  for (const f of fs.readdirSync(themeDir)) {
    fs.rmSync(path.join(themeDir, f), { recursive: true, force: true });
  }
  console.log(`Theme: ${themeArg} → ${themeDir}`);
} else {
  fs.mkdirSync(CANVAS_ROOT, { recursive: true });
  for (const f of fs.readdirSync(CANVAS_ROOT)) {
    fs.rmSync(path.join(CANVAS_ROOT, f), { recursive: true, force: true });
  }
  console.log(`Cleared ${CANVAS_ROOT}`);
}

const totalStart = Date.now();
let passed = 0;
let failed = 0;

for (const script of SCRIPTS) {
  const label = script.replace(".js", "");
  process.stdout.write(`\n[${label}]\n`);

  const start = Date.now();
  const result = spawnSync(process.execPath, [path.join(DIR, script), ...extraArgs], {
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
