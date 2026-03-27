#!/usr/bin/env node

// Check that the Slack bot token has the required scopes.
// Usage: node check-scopes.js
// Requires env: SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_REFRESH_TOKEN

const path = require("path");
// Resolve deps from sibling dispatch-slack skill
module.paths.unshift(path.join(__dirname, "../../dispatch-slack/node_modules"));
require("dotenv").config();
const { WebClient } = require("@slack/web-api");

const REQUIRED_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "channels:join",
  "channels:read",
  "chat:write",
  "chat:write.customize",
  "commands",
  "emoji:read",
  "files:read",
  "files:write",
  "groups:history",
  "groups:read",
  "im:history",
  "mpim:history",
  "mpim:read",
  "reactions:read",
  "reactions:write",
  "users:read",
  "users:read.email",
  "usergroups:read",
  "assistant:write",
  "canvases:read",
  "canvases:write",
  "search:read.files",
  "search:read.im",
  "search:read.mpim",
  "search:read.private",
  "search:read.public",
  "search:read.users",
];

async function main() {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const refreshToken = process.env.SLACK_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    console.error(
      "Missing required env vars: SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_REFRESH_TOKEN"
    );
    process.exit(1);
  }

  try {
    const client = new WebClient();
    const result = await client.oauth.v2.access({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    const grantedScopes = result.scope.split(",");
    const missing = REQUIRED_SCOPES.filter(
      (s) => !grantedScopes.includes(s)
    );

    console.log("Granted scopes:", grantedScopes.join(", "));
    console.log("");

    if (missing.length === 0) {
      console.log("All required scopes are present.");
    } else {
      console.error("Missing required scopes:");
      for (const scope of missing) {
        console.error(`  - ${scope}`);
      }
      console.error(
        "\nAdd these scopes in your Slack app's OAuth & Permissions page,"
      );
      console.error("then reinstall the app to the workspace.");
      process.exit(1);
    }
  } catch (err) {
    console.error("Scope check failed:", err.message);
    process.exit(1);
  }
}

main();
