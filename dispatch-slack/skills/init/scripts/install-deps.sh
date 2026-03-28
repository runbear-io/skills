#!/bin/bash

# Install dependencies for the dispatch-slack skill.
# All deps live in the dispatch-slack skill's node_modules.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DISPATCH_SLACK_DIR="$(cd "$SCRIPT_DIR/../../dispatch-slack" && pwd)"

echo "Installing dependencies in $DISPATCH_SLACK_DIR..."
cd "$DISPATCH_SLACK_DIR" && npm install
echo "Done."
