#!/bin/bash
# UIC Maintenance Script — rediscover, diff, update, regenerate
set -euo pipefail

PROJECT_ROOT="${1:-.}"
cd "$PROJECT_ROOT"

echo "🔄 UIC Maintenance"
echo ""

# Find tool
if [ -f "./tool/dist/cli.js" ]; then
  UIC="node ./tool/dist/cli.js"
elif command -v uic >/dev/null 2>&1; then
  UIC="uic"
else
  echo "❌ UIC tool not found"
  exit 1
fi

# 1. Rediscover
echo "Step 1: Rediscovering UI surface..."
$UIC discover --persona user

# 2. Diff
echo ""
echo "Step 2: Checking for contract drift..."
$UIC contract diff

# 3. Update
echo ""
echo "Step 3: Updating contract..."
$UIC contract update

# 4. Regenerate tests
echo ""
echo "Step 4: Regenerating tests..."
$UIC test gen

# 5. Gate
echo ""
echo "Step 5: Running coverage gate..."
$UIC gate || echo "⚠️  Gate failed — review the issues above"
