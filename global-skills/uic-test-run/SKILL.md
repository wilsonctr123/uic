---
name: uic-test-run
version: 2.1.0
description: |
  Run Playwright E2E tests against the live frontend. Auto-starts the dev server.
  Use when asked to "run tests", "execute e2e tests", "run playwright".
allowed-tools:
  - Bash
  - Read

---

# /uic-test-run

```bash
UIC_BIN=$(bash ~/.claude/skills/uic/bin/find-uic.sh)
[ -z "$UIC_BIN" ] && echo "UIC not found. Install: git clone https://github.com/wilsonctr123/uic.git tool/ && cd tool && npm install && npm run build" && exit 1
```

Run `$UIC_BIN test run $ARGUMENTS`

The tool auto-starts the dev server.
Report: pass/fail counts, test results path. If tests fail, report failures.
