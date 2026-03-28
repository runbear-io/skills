const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const { AttachmentBuilder } = require("discord.js");
const { query } = require("@anthropic-ai/claude-agent-sdk");

// File extensions eligible for Discord attachment
const ATTACHMENT_EXTENSIONS_LIST = [
  ".pdf", ".md", ".txt", ".csv", ".json", ".xml", ".html", ".htm",
  ".log", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
  ".js", ".ts", ".py", ".rb", ".sh", ".bash", ".zsh",
  ".c", ".cpp", ".h", ".java", ".go", ".rs", ".swift",
  ".sql", ".graphql", ".proto", ".diff", ".patch",
];
const ATTACHMENT_EXTENSIONS = new Set(ATTACHMENT_EXTENSIONS_LIST);

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
  // Session per thread, per DM, or per channel
  const threadKey = message.channel.isThread()
    ? message.channel.id
    : message.channelId;

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

    const discordHints = [
      "You are responding in Discord. Discord does not render markdown tables.",
      "When you need to display tabular data, use ASCII text tables with + - | characters wrapped in a code block.",
      "Example:",
      "```",
      "+--------+-------+--------+",
      "| Name   | Role  | Status |",
      "+--------+-------+--------+",
      "| Alice  | Admin | Active |",
      "| Bob    | User  | Idle   |",
      "+--------+-------+--------+",
      "```",
      "Keep responses concise. Discord messages have a 2000 character limit.",
      "",
      "IMPORTANT: Files you create or write will be automatically attached to your Discord reply.",
      "When asked to generate a file (PDF, markdown, text, CSV, etc.), use the Write tool to create it.",
      "Do NOT tell the user to find the file on disk — it will be sent to them as a Discord attachment.",
    ].join("\n");

    const userPrompt = process.env.CLAUDE_SYSTEM_PROMPT || "";
    options.systemPrompt = userPrompt
      ? `${userPrompt}\n\n${discordHints}`
      : discordHints;

    let latestText = "";
    let toolNames = [];
    let writtenFiles = [];
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
            // Tool use — update progress and track written files
            if ("name" in block) {
              toolNames.push(block.name);
              if (block.name === "Write" && block.input?.file_path) {
                writtenFiles.push(block.input.file_path);
              }
              // Track files created via Bash commands
              if (block.name === "Bash" && block.input?.command) {
                const bashPaths = extractFilePathsFromBash(block.input.command);
                writtenFiles.push(...bashPaths);
              }
              const status = toolNames.map((t) => `:wrench: ${t}`).join("\n");
              await safeEdit(`:hourglass: Working on it...\n${status}`);
            }

            // Text — stream it with progress indicator
            if ("text" in block) {
              latestText = block.text;
              const now = Date.now();
              if (now - lastEditTime >= EDIT_INTERVAL) {
                await safeEdit(latestText + "\n\n...⏳");
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
    const chunks = splitMessageBySections(finalText, MAX_MESSAGE_LENGTH);
    await safeEdit(chunks[0]);
    for (let i = 1; i < chunks.length; i++) {
      await message.channel.send(chunks[i]);
    }

    // Also scan response text for file paths as fallback
    const textPaths = extractFilePathsFromText(finalText);
    writtenFiles.push(...textPaths);

    // Send written files as attachments
    const attachments = collectAttachments(writtenFiles);
    if (attachments.length) {
      await message.channel.send({ files: attachments });
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

/**
 * Extract file paths with eligible extensions from a bash command string.
 * Looks for absolute paths (e.g., /tmp/output.pdf) or quoted paths.
 */
function extractFilePathsFromBash(command) {
  const extPattern = ATTACHMENT_EXTENSIONS_LIST.map((e) => e.replace(".", "\\.")).join("|");
  const regex = new RegExp(`(?:^|\\s|"|')(/[^\\s"']+(?:${extPattern}))`, "gi");
  const paths = [];
  let match;
  while ((match = regex.exec(command)) !== null) {
    paths.push(match[1]);
  }
  return paths;
}

/**
 * Extract file paths from response text (e.g., "saved at /tmp/sample.pdf").
 */
function extractFilePathsFromText(text) {
  const extPattern = ATTACHMENT_EXTENSIONS_LIST.map((e) => e.replace(".", "\\.")).join("|");
  const regex = new RegExp(`(/[^\\s\`"'\\)\\]]+(?:${extPattern}))`, "gi");
  const paths = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    paths.push(match[1]);
  }
  return paths;
}

/**
 * Collect attachments from written file paths.
 * Only includes files that exist, have eligible extensions, and are under 25MB (Discord limit).
 */
function collectAttachments(filePaths) {
  const seen = new Set();
  const attachments = [];
  const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB Discord limit

  for (const filePath of filePaths) {
    if (seen.has(filePath)) continue;
    seen.add(filePath);

    const ext = path.extname(filePath).toLowerCase();
    if (!ATTACHMENT_EXTENSIONS.has(ext)) continue;

    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > MAX_FILE_SIZE || stat.size === 0) continue;
      attachments.push(new AttachmentBuilder(filePath, { name: path.basename(filePath) }));
    } catch {
      // File doesn't exist or can't be read — skip
    }
  }

  return attachments;
}

/**
 * Split text into chunks that fit within Discord's message limit,
 * preserving logical sections (headings, code blocks, paragraphs)
 * instead of cutting mid-content.
 */
function splitMessageBySections(text, maxLength) {
  if (text.length <= maxLength) return [text];

  // Split into logical sections: headings, code blocks, and paragraph groups
  const sections = parseIntoSections(text);

  const chunks = [];
  let current = "";

  for (const section of sections) {
    // If a single section exceeds the limit, split it further
    if (section.length > maxLength) {
      // Flush current buffer first
      if (current) {
        chunks.push(current.trimEnd());
        current = "";
      }
      // Split oversized section by lines
      const subChunks = splitLongSection(section, maxLength);
      chunks.push(...subChunks);
      continue;
    }

    // Check if adding this section would exceed the limit
    const combined = current ? current + "\n" + section : section;
    if (combined.length > maxLength) {
      // Flush current buffer, start new chunk with this section
      if (current) chunks.push(current.trimEnd());
      current = section;
    } else {
      current = combined;
    }
  }

  if (current) chunks.push(current.trimEnd());
  return chunks.length ? chunks : [text.slice(0, maxLength)];
}

/**
 * Parse markdown text into logical sections:
 * - Code blocks (``` ... ```) are kept as single sections
 * - Headings (# ...) start new sections
 * - Consecutive non-empty lines are grouped as paragraph sections
 * - Blank lines separate paragraph groups
 */
function parseIntoSections(text) {
  const lines = text.split("\n");
  const sections = [];
  let current = [];
  let inCodeBlock = false;

  const flush = () => {
    if (current.length) {
      sections.push(current.join("\n"));
      current = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isCodeFence = /^```/.test(line.trimStart());

    if (isCodeFence && !inCodeBlock) {
      // Start of code block — flush anything before it
      flush();
      inCodeBlock = true;
      current.push(line);
    } else if (isCodeFence && inCodeBlock) {
      // End of code block — include closing fence and flush
      current.push(line);
      inCodeBlock = false;
      flush();
    } else if (inCodeBlock) {
      current.push(line);
    } else if (/^#{1,6}\s/.test(line)) {
      // Heading starts a new section
      flush();
      current.push(line);
    } else if (line.trim() === "") {
      // Blank line separates paragraph groups
      if (current.length) {
        flush();
      }
    } else {
      current.push(line);
    }
  }

  // Handle unterminated code block
  flush();
  return sections;
}

/**
 * Split an oversized section by lines, falling back to character split.
 */
function splitLongSection(text, maxLength) {
  const lines = text.split("\n");
  const chunks = [];
  let current = "";

  for (const line of lines) {
    const combined = current ? current + "\n" + line : line;
    if (combined.length > maxLength) {
      if (current) chunks.push(current);
      // Single line longer than maxLength — hard split
      if (line.length > maxLength) {
        let remaining = line;
        while (remaining.length > maxLength) {
          chunks.push(remaining.slice(0, maxLength));
          remaining = remaining.slice(maxLength);
        }
        current = remaining;
      } else {
        current = line;
      }
    } else {
      current = combined;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

module.exports = { createDiscordBot };
