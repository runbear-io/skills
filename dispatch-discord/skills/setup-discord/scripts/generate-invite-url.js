#!/usr/bin/env node

// Generate a Discord bot invite URL with the required permissions.
// Usage: node generate-invite-url.js
// Requires: DISCORD_APPLICATION_ID in .env or as environment variable

const path = require("path");
// Resolve deps from sibling dispatch-discord skill
module.paths.unshift(path.join(__dirname, "../../dispatch-discord/node_modules"));
require("dotenv").config();

function main() {
  const appId = process.env.DISCORD_APPLICATION_ID;

  if (!appId) {
    console.error("DISCORD_APPLICATION_ID not found in .env");
    console.error("Run the setup flow first to store the Application ID.");
    process.exit(1);
  }

  // Permission integer: ViewChannel (1024) + SendMessages (2048) + ReadMessageHistory (65536)
  const permissions = 67584;
  const url = `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot&permissions=${permissions}`;

  console.log("Open this URL in your browser to invite the bot to your server:\n");
  console.log(url);
}

main();
