const { Client, GatewayIntentBits, Partials } = require("discord.js");
const { query } = require("@anthropic-ai/claude-agent-sdk");

// Track sessions per Discord thread (channelId:threadId -> sessionId)
const threadSessions = new Map();

// Throttle interval for message edits (ms) — Discord allows ~5 edits per 5s
const EDIT_INTERVAL = 1200;

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
  // Use thread ID if in a thread, otherwise use the message's channel + ts
  const threadKey = message.channel.isThread()
    ? message.channel.id
    : `${message.channelId}:${message.id}`;

  // Send initial thinking message
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

    let fullText = "";
    let lastEditTime = 0;
    let pendingEdit = null;

    const editReply = async (text) => {
      // Truncate to Discord's limit
      const truncated =
        text.length > MAX_MESSAGE_LENGTH
          ? text.slice(0, MAX_MESSAGE_LENGTH - 3) + "..."
          : text;
      try {
        await reply.edit(truncated);
      } catch (err) {
        console.error("Message edit error:", err.message);
      }
    };

    const appendText = async (text) => {
      fullText = text;
      const now = Date.now();
      const timeSinceLastEdit = now - lastEditTime;

      if (timeSinceLastEdit >= EDIT_INTERVAL) {
        if (pendingEdit) {
          clearTimeout(pendingEdit);
          pendingEdit = null;
        }
        lastEditTime = now;
        await editReply(fullText);
      } else if (!pendingEdit) {
        const delay = EDIT_INTERVAL - timeSinceLastEdit;
        pendingEdit = setTimeout(async () => {
          pendingEdit = null;
          lastEditTime = Date.now();
          await editReply(fullText);
        }, delay);
      }
    };

    const processStream = async (queryOptions) => {
      for await (const msg of query({ prompt: content, options: queryOptions })) {
        if (msg.type === "system" && msg.subtype === "init") {
          newSessionId = msg.session_id;
        }

        if (msg.type === "assistant" && msg.message?.content) {
          for (const block of msg.message.content) {
            if ("text" in block) {
              await appendText(block.text);
            }
          }
        }
      }
    };

    try {
      await processStream(options);
    } catch (err) {
      // If session resume failed, retry without resuming
      if (sessionId && err.message && err.message.includes("session")) {
        console.log(`Session ${sessionId} not found, starting fresh`);
        threadSessions.delete(threadKey);
        delete options.resume;
        fullText = "";
        await processStream(options);
      } else {
        throw err;
      }
    }

    // Flush any pending edit
    if (pendingEdit) {
      clearTimeout(pendingEdit);
      pendingEdit = null;
    }

    if (newSessionId) {
      threadSessions.set(threadKey, newSessionId);
    }

    // Final edit with complete response
    const finalText = fullText || "No response generated.";

    // Split into multiple messages if response exceeds Discord's limit
    if (finalText.length > MAX_MESSAGE_LENGTH) {
      await editReply(finalText.slice(0, MAX_MESSAGE_LENGTH));
      const remaining = finalText.slice(MAX_MESSAGE_LENGTH);
      const chunks = splitMessage(remaining, MAX_MESSAGE_LENGTH);
      for (const chunk of chunks) {
        await message.channel.send(chunk);
      }
    } else {
      await editReply(finalText);
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
