FROM node:22-slim

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user (Claude Code blocks bypassPermissions as root)
RUN useradd -m -s /bin/bash claude

# Create app directory
WORKDIR /app

# Copy package files and install deps
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy source
COPY scripts/ scripts/

# Switch to non-root user
USER claude

EXPOSE ${PORT:-3031}

ENTRYPOINT ["node", "scripts/index.js"]
