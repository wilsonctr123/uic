#!/bin/bash
# UIC Bootstrap Script — used by the Claude Code skill to set up UIC in a new repo
set -euo pipefail

PROJECT_ROOT="${1:-.}"
cd "$PROJECT_ROOT"

echo "🚀 UIC Bootstrap"
echo ""

# 1. Find or build the UIC tool
if [ -f "./tool/dist/cli.js" ]; then
  UIC="node ./tool/dist/cli.js"
  echo "  ✅ UIC tool found (local)"
elif command -v uic >/dev/null 2>&1; then
  UIC="uic"
  echo "  ✅ UIC tool found (global)"
else
  echo "  ❌ UIC tool not found."
  echo "     Install: npm install -g uic"
  echo "     Or: cd tool && npm install && npm run build"
  exit 1
fi

# 2. Initialize config if needed
if [ ! -f "uic.config.ts" ] && [ ! -f "uic.config.js" ]; then
  echo ""
  echo "📝 Creating uic.config.ts..."
  $UIC init
else
  echo "  ✅ Config exists"
fi

# 3. Check Playwright
if ! npx playwright --version >/dev/null 2>&1; then
  echo ""
  echo "📦 Installing Playwright..."
  npm install -D @playwright/test
  npx playwright install chromium
fi

# 4. Run doctor
echo ""
$UIC doctor

echo ""
echo "✅ Bootstrap complete. Next steps:"
echo "   1. Start your dev server"
echo "   2. Set TEST_USER_EMAIL and TEST_USER_PASSWORD env vars"
echo "   3. Run: /uic-discover"
echo "   4. Run: /uic-contract-gen"
echo "   5. Run: /uic-test-gen"
echo "   6. Run: /uic-gate"
