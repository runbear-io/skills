#!/usr/bin/env node

// Verify a Slack bot refresh token by exchanging it for an access token.
// Usage: node verify-token.js
// Requires env: SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_REFRESH_TOKEN

const path = require("path");
// Resolve deps from sibling dispatch-slack skill
module.paths.unshift(path.join(__dirname, "../../dispatch-slack/node_modules"));
require("dotenv").config();
const { WebClient } = require("@slack/web-api");

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

    console.log("Token verification successful!");
    console.log(`  Team: ${result.team.name} (${result.team.id})`);
    console.log(`  Bot User ID: ${result.bot_user_id}`);
    console.log(`  Scopes: ${result.scope}`);
    console.log(`  Expires in: ${result.expires_in}s`);
    console.log(`  New refresh token: ${result.refresh_token.slice(0, 20)}...`);
  } catch (err) {
    console.error("Token verification failed:", err.message);
    if (err.data) {
      console.error("  Error detail:", err.data.error);
    }
    process.exit(1);
  }
}

main();
