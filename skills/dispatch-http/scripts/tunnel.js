const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const { spawn } = require("child_process");

// Parse CLI flags
function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) parsed.port = parseInt(args[++i], 10);
    else if (args[i] === "--cwd" && args[i + 1]) parsed.cwd = args[++i];
  }
  return parsed;
}

const args = parseArgs(process.argv.slice(2));
const PORT = args.port || process.env.PORT || 3000;

// Forward flags to the server
const serverArgs = [path.join(__dirname, "index.js"), "--port", String(PORT)];
if (args.cwd) serverArgs.push("--cwd", args.cwd);

// Start the Express server
const server = spawn("node", serverArgs, {
  stdio: "inherit",
});

// Start cloudflared quick tunnel after a short delay
setTimeout(() => {
  const tunnel = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${PORT}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  tunnel.stderr.on("data", (data) => {
    const line = data.toString();
    const match = line.match(/https:\/\/[^\s]+\.trycloudflare\.com/);
    if (match) {
      console.log(`Cloudflare tunnel established at: ${match[0]}`);
    }
  });

  tunnel.on("error", (err) => {
    console.error("Error starting cloudflared tunnel:", err.message);
    server.kill();
    process.exit(1);
  });

  tunnel.on("close", (code) => {
    if (code !== 0) {
      console.error(`cloudflared exited with code ${code}`);
      server.kill();
      process.exit(1);
    }
  });

  process.on("SIGINT", () => {
    tunnel.kill();
    server.kill();
    process.exit();
  });
}, 1000);
