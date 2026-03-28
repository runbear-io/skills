#!/usr/bin/env node

// Store the Slack app-level token (xapp-...) in .env.
// Comments out any previous SLACK_APP_TOKEN value.
// Usage: node store-app-token.js <xapp-token>

const fs = require("fs");
const path = require("path");

const ENV_FILE = path.join(process.cwd(), ".env");

function main() {
  const token = process.argv[2];
  if (!token) {
    console.error("Usage: store-app-token.js <xapp-token>");
    process.exit(1);
  }

  if (!token.startsWith("xapp-")) {
    console.error("Warning: App-level tokens usually start with 'xapp-'");
  }

  let content = "";
  if (fs.existsSync(ENV_FILE)) {
    content = fs.readFileSync(ENV_FILE, "utf8");
    // Comment out existing SLACK_APP_TOKEN lines
    content = content.replace(
      /^(SLACK_APP_TOKEN=.*)$/gm,
      "# $1"
    );
    content = content.trimEnd() + "\n";
  }

  content += `SLACK_APP_TOKEN=${token}\n`;
  fs.writeFileSync(ENV_FILE, content);

  console.log(`SLACK_APP_TOKEN stored in ${ENV_FILE}`);
  if (content.includes("# SLACK_APP_TOKEN=")) {
    console.log("  (previous value commented out)");
  }
}

main();
