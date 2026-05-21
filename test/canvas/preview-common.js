/**
 * Shared constants and helpers for canvas preview scripts.
 * Usage: const { THEMES, OUT_DIR, AVATAR_DIR, PLAYERS, avatarPath, mockUser, saveRender } = require("./preview-common");
 *
 * Pass --theme <id> to render a single theme instead of the default batch:
 *   node preview-slots.js --theme neon
 *   npm run preview:canvas -- --theme neon
 */
const path = require("path");
const fs = require("fs");

const DEFAULT_THEMES = ["classic", "memecult", "dessert", "sunset", "noir"];
const _themeArgIdx = process.argv.indexOf("--theme");
const THEMES = _themeArgIdx !== -1 && process.argv[_themeArgIdx + 1]
  ? [process.argv[_themeArgIdx + 1]]
  : DEFAULT_THEMES;

const OUT_DIR = path.join(__dirname, "../../tmp/canvas");
const AVATAR_DIR = path.join(__dirname, "avatars");

const PLAYERS = [
  { id: "u1", name: "GrandGambler99",   color: "#e74c3c", avatar: 1 },
  { id: "u2", name: "HotHandHannah",   color: "#3498db", avatar: 2 },
  { id: "u3", name: "BigBettorBruno",  color: "#2ecc71", avatar: 3 },
  { id: "u4", name: "LuckyLarryLong",  color: "#f39c12", avatar: 4 },
  { id: "u5", name: "NightOwlNorbert", color: "#9b59b6", avatar: 5 },
  { id: "u6", name: "SteadyEddie",     color: "#1abc9c", avatar: 6 },
  { id: "u7", name: "RecklessRachel",  color: "#e67e22", avatar: 7 },
];

function avatarPath(n) {
  return path.join(AVATAR_DIR, `${n}.jpg`);
}

function mockUser(name, avatarN = 1) {
  return {
    displayName: name,
    displayAvatarURL: () => avatarPath(avatarN),
  };
}

function saveRender(attachment, filename) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, filename);
  fs.writeFileSync(outPath, attachment.attachment);
  console.log(`→ ${outPath}`);
}

module.exports = { THEMES, OUT_DIR, AVATAR_DIR, PLAYERS, avatarPath, mockUser, saveRender };
