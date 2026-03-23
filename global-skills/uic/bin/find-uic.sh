#!/bin/bash
# Find the UIC CLI binary. Checks in order:
# 1. ./tool/dist/cli.js (project-local install)
# 2. npx uic (global npm install)
# 3. UIC_HOME env var
# 4. /Users/Shared/uic/dist/cli.js (development install)

if [ -f "./tool/dist/cli.js" ]; then
  echo "node ./tool/dist/cli.js"
elif command -v uic >/dev/null 2>&1; then
  echo "uic"
elif [ -n "$UIC_HOME" ] && [ -f "$UIC_HOME/dist/cli.js" ]; then
  echo "node $UIC_HOME/dist/cli.js"
elif [ -f "/Users/Shared/uic/dist/cli.js" ]; then
  echo "node /Users/Shared/uic/dist/cli.js"
else
  echo ""
fi
