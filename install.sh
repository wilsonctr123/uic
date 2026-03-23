#!/bin/bash
# UIC Installer — checks prerequisites, installs everything needed
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_DIR="$HOME/.claude/skills"
ERRORS=0

echo "🔧 UIC Installer"
echo ""

# ── Step 1: Check prerequisites ──────────────────────────────────

echo "Checking prerequisites..."
echo ""

# Node.js >= 18
if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VER" -ge 18 ]; then
    echo "  ✅ Node.js $(node -v)"
  else
    echo "  ❌ Node.js $(node -v) — need >= 18"
    echo "     Install: https://nodejs.org or brew install node"
    ERRORS=$((ERRORS + 1))
  fi
else
  echo "  ❌ Node.js not found"
  echo "     Install: https://nodejs.org or brew install node"
  ERRORS=$((ERRORS + 1))
fi

# npm
if command -v npm >/dev/null 2>&1; then
  echo "  ✅ npm $(npm -v)"
else
  echo "  ❌ npm not found (comes with Node.js)"
  ERRORS=$((ERRORS + 1))
fi

# Git
if command -v git >/dev/null 2>&1; then
  echo "  ✅ git $(git --version | awk '{print $3}')"
else
  echo "  ❌ git not found"
  echo "     Install: https://git-scm.com or brew install git"
  ERRORS=$((ERRORS + 1))
fi

# Claude Code (optional)
if [ -d "$HOME/.claude" ]; then
  echo "  ✅ Claude Code detected"
else
  echo "  ⬜ Claude Code not detected (optional — CLI works without it)"
fi

# Playwright
if npx playwright --version >/dev/null 2>&1; then
  echo "  ✅ Playwright $(npx playwright --version 2>/dev/null)"
else
  echo "  ⬜ Playwright not installed — will install now"
fi

echo ""

if [ "$ERRORS" -gt 0 ]; then
  echo "❌ $ERRORS prerequisite(s) missing. Fix them and re-run."
  exit 1
fi

# ── Step 2: Install npm dependencies + build CLI ──────────────────

echo "Installing UIC dependencies..."
cd "$SCRIPT_DIR"
npm install 2>&1 | tail -1
echo "  ✅ Dependencies installed"

echo ""
echo "Building UIC CLI..."
npm run build 2>&1 | tail -1
echo "  ✅ CLI built at $SCRIPT_DIR/dist/cli.js"

# ── Step 3: Install Playwright browser ────────────────────────────

if ! npx playwright --version >/dev/null 2>&1; then
  echo ""
  echo "Installing Playwright..."
  npm install -g @playwright/test 2>&1 | tail -1
fi

echo ""
echo "Installing Chromium browser for Playwright..."
npx playwright install chromium 2>&1 | tail -3
echo "  ✅ Chromium installed"

# ── Step 4: Install global Claude Code skills ─────────────────────

if [ -d "$HOME/.claude" ]; then
  echo ""
  echo "Installing global Claude Code skills..."
  for skill_dir in "$SCRIPT_DIR"/global-skills/*/; do
    skill_name=$(basename "$skill_dir")
    mkdir -p "$SKILLS_DIR/$skill_name"
    cp -r "$skill_dir"* "$SKILLS_DIR/$skill_name/"
    echo "  ✅ /$skill_name"
  done
  chmod +x "$SKILLS_DIR/uic/bin/find-uic.sh" 2>/dev/null || true
  echo ""
  echo "  12 slash commands installed globally:"
  echo "  /uic  /uic-init  /uic-doctor  /uic-discover  /uic-contract-gen"
  echo "  /uic-contract-diff  /uic-contract-update  /uic-test-gen"
  echo "  /uic-test-run  /uic-optimize-loop  /uic-gate  /uic-report"
else
  echo ""
  echo "⬜ Claude Code not detected — skipping global skill install."
  echo "  You can still use the CLI directly: node $SCRIPT_DIR/dist/cli.js"
fi

# ── Done ──────────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════"
echo "  ✅ UIC installation complete!"
echo "════════════════════════════════════════════════════"
echo ""
echo "  Next steps:"
echo "  1. cd into your webapp project"
echo "  2. /uic-init          (detect framework, create config)"
echo "  3. Add to .env:       TEST_USER_EMAIL=... TEST_USER_PASSWORD=..."
echo "  4. /uic               (run the full pipeline)"
echo ""
