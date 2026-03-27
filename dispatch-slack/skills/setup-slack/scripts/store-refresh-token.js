#!/usr/bin/env node

// Store a Slack configuration refresh token in .env.
// Comments out any previous SLACK_REFRESH_TOKEN value.
// Usage: node store-refresh-token.js <refresh-token>

const fs = require("fs");
const path = require("path");

const ENV_FILE = path.join(process.cwd(), ".env");

function main() {
  const token = process.argv[2];
  if (!token) {
    console.error("Usage: store-refresh-token.js <refresh-token>");
    process.exit(1);
  }

  let content = "";
  if (fs.existsSync(ENV_FILE)) {
    content = fs.readFileSync(ENV_FILE, "utf8");
    // Comment out existing SLACK_REFRESH_TOKEN lines
    content = content.replace(
      /^(SLACK_REFRESH_TOKEN=.*)$/gm,
      "# $1"
    );
    content = content.trimEnd() + "\n";
  }

  content += `SLACK_REFRESH_TOKEN=${token}\n`;
  fs.writeFileSync(ENV_FILE, content);

  console.log(`SLACK_REFRESH_TOKEN stored in ${ENV_FILE}`);
  if (content.includes("# SLACK_REFRESH_TOKEN=")) {
    console.log("  (previous value commented out)");
  }
}

main();
