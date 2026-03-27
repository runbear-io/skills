#!/usr/bin/env node

// Install Slack app to workspace via OAuth and capture bot tokens.
// Opens the Slack OAuth page directly in the browser, runs a minimal
// local server to handle the redirect callback.
//
// Usage: node install-app.js [port]
// Default port: 3333

const path = require("path");
// Resolve deps from sibling dispatch-slack skill
module.paths.unshift(path.join(__dirname, "../../dispatch-slack/node_modules"));
require("dotenv").config();
const http = require("http");
const fs = require("fs");
const { URL } = require("url");
const { exec } = require("child_process");

const PORT = parseInt(process.argv[2] || "3333", 10);
const ENV_FILE = path.join(process.cwd(), ".env");
const REDIRECT_URI = `http://localhost:${PORT}/oauth/callback`;

const clientId = process.env.SLACK_CLIENT_ID;
const clientSecret = process.env.SLACK_CLIENT_SECRET;
const appId = process.env.SLACK_APP_ID;

if (!clientId || !clientSecret) {
  console.error("Missing SLACK_CLIENT_ID or SLACK_CLIENT_SECRET in .env");
  console.error("Run create-slack-app.js first.");
  process.exit(1);
}

const BOT_SCOPES = [
  "app_mentions:read", "channels:history", "channels:join", "channels:read",
  "chat:write", "chat:write.customize", "commands", "emoji:read",
  "files:read", "files:write", "groups:history", "groups:read",
  "im:history", "mpim:history", "mpim:read", "reactions:read",
  "reactions:write", "users:read", "users:read.email", "usergroups:read",
  "assistant:write", "canvases:read", "canvases:write",
  "search:read.files", "search:read.im", "search:read.mpim",
  "search:read.private", "search:read.public", "search:read.users",
].join(",");

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

async function updateManifestRedirectUrl() {
  const configRefreshToken = process.env.SLACK_REFRESH_TOKEN;
  if (!configRefreshToken) return;

  try {
    const rotateResp = await fetch("https://slack.com/api/tooling.tokens.rotate", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ refresh_token: configRefreshToken }),
    });
    const rotateData = await rotateResp.json();
    if (!rotateData.ok) {
      console.error(`Config token rotation failed: ${rotateData.error}`);
      return;
    }
    updateEnvFile({ SLACK_REFRESH_TOKEN: rotateData.refresh_token });

    const exportResp = await fetch("https://slack.com/api/apps.manifest.export", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${rotateData.token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ app_id: appId }),
    });
    const exportData = await exportResp.json();
    if (!exportData.ok) {
      console.error(`Manifest export failed: ${exportData.error}`);
      return;
    }

    const manifest = exportData.manifest;
    if (!manifest.oauth_config) manifest.oauth_config = {};
    manifest.oauth_config.redirect_urls = [REDIRECT_URI];

    const updateResp = await fetch("https://slack.com/api/apps.manifest.update", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${rotateData.token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ app_id: appId, manifest }),
    });
    const updateData = await updateResp.json();
    if (!updateData.ok) {
      console.error(`Manifest update failed: ${updateData.error}`);
    }
  } catch (err) {
    console.error(`Manifest update error: ${err.message}`);
  }
}

async function main() {
  console.log("Updating app manifest with OAuth redirect URL...");
  await updateManifestRedirectUrl();

  const installUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${BOT_SCOPES}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

  // Start local server to catch the OAuth redirect
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname !== "/oauth/callback") {
      res.writeHead(404);
      res.end();
      return;
    }

    const error = url.searchParams.get("error");
    if (error) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<html><body><h2>Error: ${error}</h2><p>You can close this tab.</p></body></html>`);
      console.error(`OAuth error: ${error}`);
      server.close();
      process.exit(1);
      return;
    }

    const code = url.searchParams.get("code");
    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(`<html><body><h2>No authorization code received</h2></body></html>`);
      return;
    }

    // Exchange code for tokens
    try {
      const tokenResp = await fetch("https://slack.com/api/oauth.v2.access", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: REDIRECT_URI,
        }),
      });
      const tokenData = await tokenResp.json();

      if (!tokenData.ok) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body><h2>Token exchange failed: ${tokenData.error}</h2><p>You can close this tab.</p></body></html>`);
        console.error(`Token exchange failed: ${tokenData.error}`);
        server.close();
        process.exit(1);
        return;
      }

      const envUpdates = {};
      if (tokenData.refresh_token) {
        envUpdates.SLACK_BOT_REFRESH_TOKEN = tokenData.refresh_token;
      }
      if (tokenData.access_token) {
        envUpdates.SLACK_BOT_TOKEN = tokenData.access_token;
      }
      if (Object.keys(envUpdates).length > 0) {
        updateEnvFile(envUpdates);
      }

      const teamName = tokenData.team?.name || "unknown";
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<html><body><h2>Installed to ${teamName}!</h2><p>You can close this tab and return to the terminal.</p></body></html>`);

      console.log(`\nBot installed to workspace: ${teamName} (${tokenData.team?.id})`);
      console.log("Bot tokens stored in .env");
      console.log("INSTALL_SUCCESS");

      server.close();
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end(`<html><body><h2>Error: ${err.message}</h2></body></html>`);
      console.error(err.message);
      server.close();
      process.exit(1);
    }
  });

  server.listen(PORT, () => {
    console.log(`\nOpening Slack OAuth page in browser...`);
    console.log("Waiting for you to authorize the app...\n");

    const openCmd =
      process.platform === "darwin" ? "open" :
      process.platform === "win32" ? "start" : "xdg-open";
    exec(`${openCmd} '${installUrl}'`);
  });
}

main();
