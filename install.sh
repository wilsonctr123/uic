#!/bin/bash
# UIC Installer — sets up global Claude Code skills + project-local tool
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_DIR="$HOME/.claude/skills"

echo "🔧 UIC Installer"
echo ""

# 1. Install global skills (work in any project)
echo "Installing global Claude Code skills..."
for skill_dir in "$SCRIPT_DIR"/global-skills/*/; do
  skill_name=$(basename "$skill_dir")
  mkdir -p "$SKILLS_DIR/$skill_name"
  cp -r "$skill_dir"* "$SKILLS_DIR/$skill_name/"
  echo "  ✓ /$(basename "$skill_name")"
done

# Make scripts executable
chmod +x "$SKILLS_DIR/uic/bin/find-uic.sh" 2>/dev/null || true

echo ""
echo "✅ 12 global skills installed. Available in any Claude Code session:"
echo "   /uic  /uic-init  /uic-doctor  /uic-discover  /uic-contract-gen"
echo "   /uic-contract-diff  /uic-contract-update  /uic-test-gen"
echo "   /uic-test-run  /uic-optimize-loop  /uic-gate  /uic-report"

# 2. Build the CLI tool
echo ""
echo "Building UIC CLI..."
cd "$SCRIPT_DIR"
npm install --silent 2>/dev/null
npm run build --silent 2>/dev/null
echo "  ✓ CLI built at $SCRIPT_DIR/dist/cli.js"

echo ""
echo "✅ Installation complete!"
echo ""
echo "Next steps:"
echo "  1. cd into your webapp project"
echo "  2. Type /uic-init to detect your framework and create config"
echo "  3. Create .env with TEST_USER_EMAIL and TEST_USER_PASSWORD"
echo "  4. Type /uic to run the full pipeline"
