#!/bin/bash

# Install required dependencies for the Slack bot.
# Checks which packages are missing before installing.

set -e

REQUIRED_PACKAGES=("@slack/bolt" "@slack/web-api" "@anthropic-ai/claude-agent-sdk" "express" "dotenv")
MISSING=()

for pkg in "${REQUIRED_PACKAGES[@]}"; do
  if ! node -e "require('$pkg')" 2>/dev/null; then
    MISSING+=("$pkg")
  fi
done

if [ ${#MISSING[@]} -eq 0 ]; then
  echo "All dependencies already installed."
else
  echo "Installing missing packages: ${MISSING[*]}"
  npm install "${MISSING[@]}"
  echo "Done."
fi
