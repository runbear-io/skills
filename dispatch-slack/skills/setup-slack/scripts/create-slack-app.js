#!/usr/bin/env node

// Create a Slack app using the Slack API with a configuration refresh token.
// Usage: node create-slack-app.js "<bot-name>"
//
// Reads SLACK_REFRESH_TOKEN from .env, exchanges it for an access token,
// creates a Slack app with a manifest, generates an app-level token,
// and stores all credentials in .env.

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const ENV_FILE = path.join(process.cwd(), ".env");

const BOT_SCOPES = [
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
  "users:write",
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

async function rotateConfigToken(refreshToken) {
  const resp = await fetch("https://slack.com/api/tooling.tokens.rotate", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: refreshToken }),
  });
  const data = await resp.json();
  if (!data.ok) {
    throw new Error(`tooling.tokens.rotate failed: ${data.error}`);
  }
  return {
    accessToken: data.token,
    refreshToken: data.refresh_token,
    expiresIn: data.exp,
  };
}

async function createApp(accessToken, botName) {
  const manifest = {
    display_information: {
      name: botName,
      description: `${botName} - Claude Agent Slack Bot`,
    },
    features: {
      app_home: {
        home_tab_enabled: false,
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
      bot_user: {
        display_name: botName,
        always_online: false,
      },
    },
    oauth_config: {
      scopes: {
        bot: BOT_SCOPES,
      },
    },
    settings: {
      event_subscriptions: {
        bot_events: ["app_mention", "message.im", "member_joined_channel"],
      },
      interactivity: {
        is_enabled: false,
      },
      org_deploy_enabled: false,
      socket_mode_enabled: true,
      token_rotation_enabled: false,
    },
  };

  const resp = await fetch("https://slack.com/api/apps.manifest.create", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ manifest }),
  });
  const data = await resp.json();
  if (!data.ok) {
    throw new Error(
      `apps.manifest.create failed: ${data.error}${data.errors ? " - " + JSON.stringify(data.errors) : ""}`
    );
  }
  return data;
}

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
  const botName = process.argv[2];
  if (!botName) {
    console.error('Usage: create-slack-app.js "<bot-name>"');
    process.exit(1);
  }

  const refreshToken = process.env.SLACK_REFRESH_TOKEN;
  if (!refreshToken) {
    console.error("SLACK_REFRESH_TOKEN not found in .env");
    process.exit(1);
  }

  // Step 1: Exchange config refresh token for access token
  console.log("Exchanging configuration refresh token for access token...");
  const rotated = await rotateConfigToken(refreshToken);
  updateEnvFile({ SLACK_REFRESH_TOKEN: rotated.refreshToken });
  console.log("Updated SLACK_REFRESH_TOKEN in .env (token rotated)");

  // Step 2: Create the Slack app with manifest (includes socket mode + events)
  console.log(`\nCreating Slack app "${botName}"...`);
  const result = await createApp(rotated.accessToken, botName);

  const appId = result.app_id;
  const credentials = result.credentials;

  console.log("App created successfully!");
  console.log(`  App ID: ${appId}`);
  console.log(`  Client ID: ${credentials.client_id}`);
  console.log(`  Client Secret: ${credentials.client_secret.slice(0, 8)}...`);
  console.log(`  Signing Secret: ${credentials.signing_secret.slice(0, 8)}...`);

  // Step 3: Store all credentials in .env
  updateEnvFile({
    SLACK_APP_ID: appId,
    SLACK_CLIENT_ID: credentials.client_id,
    SLACK_CLIENT_SECRET: credentials.client_secret,
    SLACK_SIGNING_SECRET: credentials.signing_secret,
  });

  console.log("\nAll credentials stored in .env");
  console.log("\nNext steps:");
  console.log(`  1. Go to https://api.slack.com/apps/${appId}/install-on-team`);
  console.log('     Click "Install to Workspace" and authorize the app');
  console.log(`  2. Go to https://api.slack.com/apps/${appId}/general`);
  console.log('     Scroll to "App-Level Tokens", click "Generate Token"');
  console.log('     Name: "Socket Mode", Scope: "connections:write"');
  console.log('     Copy the xapp-... token');
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
