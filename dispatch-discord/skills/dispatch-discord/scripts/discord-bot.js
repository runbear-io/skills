const { Client, GatewayIntentBits, Partials } = require("discord.js");
const { query } = require("@anthropic-ai/claude-agent-sdk");

// Track sessions per Discord thread (channelId:threadId -> sessionId)
const threadSessions = new Map();

// Discord message length limit
const MAX_MESSAGE_LENGTH = 2000;

function createDiscordBot({ cwd }) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.once("ready", () => {
    console.log(`Discord bot logged in as ${client.user.tag}`);
  });

  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const isDM = !message.guild;
    const isMentioned = message.mentions.has(client.user);

    if (!isDM && !isMentioned) return;

    const content = message.content
      .replace(new RegExp(`<@!?${client.user.id}>`, "g"), "")
      .trim();

    if (!content) return;

    await handleMessage(message, content, { cwd });
  });

  return client;
}

async function handleMessage(message, content, { cwd }) {
  const threadKey = message.channel.isThread()
    ? message.channel.id
    : `${message.channelId}:${message.id}`;

  const reply = await message.reply(":hourglass: Working on it...");

  try {
    let sessionId = threadSessions.get(threadKey);
    let newSessionId = null;

    const options = {
      allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: ["project", "user"],
    };

    if (sessionId) options.resume = sessionId;
    if (cwd || process.env.CLAUDE_CWD) options.cwd = cwd || process.env.CLAUDE_CWD;
    if (process.env.CLAUDE_SYSTEM_PROMPT)
      options.systemPrompt = process.env.CLAUDE_SYSTEM_PROMPT;

    let latestText = "";
    let toolNames = [];
    let lastEditTime = 0;
    const EDIT_INTERVAL = 1200;

    const safeEdit = async (text) => {
      const truncated =
        text.length > MAX_MESSAGE_LENGTH
          ? text.slice(0, MAX_MESSAGE_LENGTH - 3) + "..."
          : text;
      try {
        await reply.edit(truncated);
        lastEditTime = Date.now();
      } catch (err) {
        console.error("Edit error:", err.message);
      }
    };

    const processStream = async (queryOptions) => {
      for await (const msg of query({ prompt: content, options: queryOptions })) {
        if (msg.type === "system" && msg.subtype === "init") {
          newSessionId = msg.session_id;
        }

        if (msg.type === "assistant" && msg.message?.content) {
          for (const block of msg.message.content) {
            // Tool use — update progress
            if ("name" in block) {
              toolNames.push(block.name);
              const status = toolNames.map((t) => `:wrench: ${t}`).join("\n");
              await safeEdit(`:hourglass: Working on it...\n${status}`);
            }

            // Text — stream it
            if ("text" in block) {
              latestText = block.text;
              const now = Date.now();
              if (now - lastEditTime >= EDIT_INTERVAL) {
                await safeEdit(latestText);
              }
            }
          }
        }
      }
    };

    try {
      await processStream(options);
    } catch (err) {
      if (sessionId && err.message && err.message.includes("session")) {
        console.log(`Session ${sessionId} not found, starting fresh`);
        threadSessions.delete(threadKey);
        delete options.resume;
        latestText = "";
        toolNames = [];
        await processStream(options);
      } else {
        throw err;
      }
    }

    if (newSessionId) {
      threadSessions.set(threadKey, newSessionId);
    }

    // Final edit with complete response
    const finalText = latestText || "No response generated.";
    if (finalText.length > MAX_MESSAGE_LENGTH) {
      await safeEdit(finalText.slice(0, MAX_MESSAGE_LENGTH));
      const remaining = finalText.slice(MAX_MESSAGE_LENGTH);
      const chunks = splitMessage(remaining, MAX_MESSAGE_LENGTH);
      for (const chunk of chunks) {
        await message.channel.send(chunk);
      }
    } else {
      await safeEdit(finalText);
    }
  } catch (err) {
    console.error("Discord handler error:", err);
    try {
      await reply.edit(`:x: Error: ${err.message}`);
    } catch {
      // Ignore edit failure
    }
  }
}

function splitMessage(text, maxLength) {
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf("\n", maxLength);
    if (splitIdx === -1 || splitIdx < maxLength / 2) {
      splitIdx = maxLength;
    }
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).replace(/^\n/, "");
  }
  return chunks;
}

module.exports = { createDiscordBot };
