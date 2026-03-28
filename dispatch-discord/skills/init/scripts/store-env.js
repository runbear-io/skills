#!/usr/bin/env node

// Store an environment variable in .env.
// Comments out any previous value of the same key.
// Usage: node store-env.js <KEY> <VALUE>

const fs = require("fs");
const path = require("path");

const ENV_FILE = path.join(process.cwd(), ".env");

function main() {
  const key = process.argv[2];
  const value = process.argv[3];

  if (!key || !value) {
    console.error("Usage: store-env.js <KEY> <VALUE>");
    process.exit(1);
  }

  let content = "";
  if (fs.existsSync(ENV_FILE)) {
    content = fs.readFileSync(ENV_FILE, "utf8");
    // Comment out existing values for this key
    const regex = new RegExp(`^(${key}=.*)$`, "gm");
    content = content.replace(regex, "# $1");
    content = content.trimEnd() + "\n";
  }

  content += `${key}=${value}\n`;
  fs.writeFileSync(ENV_FILE, content);

  console.log(`${key} stored in ${ENV_FILE}`);
  if (content.includes(`# ${key}=`)) {
    console.log("  (previous value commented out)");
  }
}

main();
