#!/bin/bash
# UIC Coverage Gate — thin adapter for Claude Code hooks
# This script calls the generalized UIC tool's gate command.
# All logic lives in the tool; this is just the hook interface.

set -euo pipefail

TOOL_DIR="$(dirname "$0")/../../tool"
PROJECT_ROOT="$(dirname "$0")/../.."

# Try compiled tool first, then npx fallback
if [ -f "$TOOL_DIR/dist/cli.js" ]; then
  node "$TOOL_DIR/dist/cli.js" gate "$@"
elif command -v uic >/dev/null 2>&1; then
  uic gate "$@"
else
  echo "⚠️  UIC tool not found. Build it: cd tool && npm run build"
  echo "   Or install globally: npm install -g uic"
  exit 2
fi
