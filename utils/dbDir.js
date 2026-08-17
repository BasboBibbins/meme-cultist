const fs = require("fs");
const path = require("path");

const DB_DIR = path.resolve(process.cwd(), "db");

// better-sqlite3 creates a missing file but never a missing parent directory.
function ensureDbDir() {
  fs.mkdirSync(DB_DIR, { recursive: true });
  return DB_DIR;
}

module.exports = { DB_DIR, ensureDbDir };
