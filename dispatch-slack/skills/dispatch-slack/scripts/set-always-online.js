#!/usr/bin/env node

// Toggle the bot's always_online setting via the Slack manifest API.
// Usage: node set-always-online.js <true|false>

const path = require("path");
require("dotenv").config({ path: path.join(process.cwd(), ".env") });
const fs = require("fs");

const ENV_FILE = path.join(process.cwd(), ".env");

function updateEnvFile(updates) {
  let content = "";
  if (fs.existsSync(ENV_FILE)) {
    content = fs.readFileSync(ENV_FILE, "utf8");
  }
  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^(${key}=.*)$`, "gm");
    content = content.replace(regex, `# $1`);
  }
  const newLines = Object.entries(updates)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  content = content.trimEnd() + "\n" + newLines + "\n";
  fs.writeFileSync(ENV_FILE, content);
}

async function main() {
  const value = process.argv[2];
  if (value !== "true" && value !== "false") {
    console.error("Usage: set-always-online.js <true|false>");
    process.exit(1);
  }

  const alwaysOnline = value === "true";
  const refreshToken = process.env.SLACK_REFRESH_TOKEN;
  const appId = process.env.SLACK_APP_ID;

  if (!refreshToken || !appId) {
    console.error("Missing SLACK_REFRESH_TOKEN or SLACK_APP_ID in .env");
    process.exit(1);
  }

  // Rotate config token
  const resp1 = await fetch("https://slack.com/api/tooling.tokens.rotate", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: refreshToken }),
  });
  const data1 = await resp1.json();
  if (!data1.ok) throw new Error(`Token rotation failed: ${data1.error}`);

  updateEnvFile({ SLACK_REFRESH_TOKEN: data1.refresh_token });

  // Export manifest
  const resp2 = await fetch("https://slack.com/api/apps.manifest.export", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data1.token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ app_id: appId }),
  });
  const data2 = await resp2.json();
  if (!data2.ok) throw new Error(`Manifest export failed: ${data2.error}`);

  // Update always_online
  const manifest = data2.manifest;
  manifest.features.bot_user.always_online = alwaysOnline;

  const resp3 = await fetch("https://slack.com/api/apps.manifest.update", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data1.token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ app_id: appId, manifest }),
  });
  const data3 = await resp3.json();
  if (!data3.ok) throw new Error(`Manifest update failed: ${data3.error}`);

  console.log(`always_online set to ${alwaysOnline}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
