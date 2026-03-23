---
name: uic
version: 2.1.0
description: |
  Run the full UIC browser-first testing pipeline in one shot.
  Auto-detects bootstrap (first run) vs maintain (existing contract) mode.
  Use when asked to "run uic", "test the UI", "browser test", "uic", or
  "generate UI tests".
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Agent
---

# /uic — Browser-First UI Testing Pipeline

## Update check (run first)

```bash
_UPD=$(~/.claude/skills/uic/bin/find-uic.sh)
if [ -n "$_UPD" ]; then
  UIC_DIR=$(dirname "$(dirname "$(echo $_UPD | sed 's/node //')")")
  _CHECK=$("$UIC_DIR/bin/uic-update-check" 2>/dev/null || true)
  [ -n "$_CHECK" ] && echo "$_CHECK" || true
fi
```

If output shows `UPGRADE_AVAILABLE <old> <new>`: tell the user
"UIC update available: v{old} → v{new}. Run `bash ~/.uic-tool/bin/uic-upgrade` to update,
or I can do it now." Use AskUserQuestion with options:
- A) Upgrade now
- B) Skip for now

If A: run the upgrade script, then continue with the pipeline.
If `JUST_UPGRADED <old> <new>`: tell user "UIC v{new} (just updated!)" and continue.

---

Run the full UIC workflow end-to-end. Accepts a mode argument:
- **bootstrap** (default if no contract exists): full first-time setup
- **maintain** (default if contract exists): rediscover, update, retest
- **status**: just check current coverage

## Find the CLI

```bash
UIC_BIN=$(bash ~/.claude/skills/uic/bin/find-uic.sh)
if [ -z "$UIC_BIN" ]; then
  echo "UIC not found. Install: git clone https://github.com/wilsonctr123/uic.git tool/ && cd tool && npm install && npm run build"
  exit 1
fi
echo "Using: $UIC_BIN"
```

## Auto-detect mode

If no argument given:
- If `.uic/contract.json` does NOT exist → **bootstrap**
- If `.uic/contract.json` exists → **maintain**

## Bootstrap mode

1. If no `uic.config.ts`, run `$UIC_BIN init` and report detected stack.
2. Run `$UIC_BIN doctor` — if it fails, report what's missing and stop.
3. Run `$UIC_BIN discover --persona user` — report route/element counts.
4. Run `$UIC_BIN contract gen` — report surface/flow/invariant counts + ledger.
5. Run `$UIC_BIN test gen` — report test file count.
6. Run `$UIC_BIN test run` — report pass/fail counts.
7. Run `$UIC_BIN optimize --iterations 3` — report repairs, pass rate.
8. Run `$UIC_BIN gate` — report final coverage.

## Maintain mode

1. Run `$UIC_BIN discover --persona user` — report what changed.
2. Run `$UIC_BIN contract diff` — report drift summary.
3. Run `$UIC_BIN contract update` — report what was updated.
4. Run `$UIC_BIN test gen` — report regenerated test count.
5. Run `$UIC_BIN test run` — report pass/fail.
6. Run `$UIC_BIN optimize --iterations 3` — report repairs, pass rate.
7. Run `$UIC_BIN gate` — report final result.

## Status mode

1. Run `$UIC_BIN doctor` — report setup.
2. Run `$UIC_BIN gate` — report coverage.

## Rules

- Stop on any command failure and report which step failed.
- Dev server is auto-started by discover and test run.
- After the final gate, give a concise summary.
