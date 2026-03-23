---
name: uic-optimize-loop
version: 2.1.0
description: |
  Diagnose test failures, repair tests/fixtures/seeds, and rerun until 100% pass rate.
  Use when asked to "fix failing tests", "optimize tests", "self-heal tests".
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Agent
---

# /uic-optimize-loop

```bash
UIC_BIN=$(bash ~/.claude/skills/uic/bin/find-uic.sh)
[ -z "$UIC_BIN" ] && echo "UIC not found. Install: git clone https://github.com/wilsonctr123/uic.git tool/ && cd tool && npm install && npm run build" && exit 1
```

Run `$UIC_BIN optimize $ARGUMENTS`

This diagnoses failures into 4 layers (test defect / precondition / expected runtime / app bug),
auto-repairs layers A/B/C, and reruns up to 3 iterations.

Layer D (app bugs) only patched with --allow-app-fixes flag.

Report: repairs applied by layer, pass rate per iteration, quality metrics, remaining failures.
