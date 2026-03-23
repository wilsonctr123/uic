---
name: uic-gate
version: 2.1.0
description: |
  Check UI coverage against contract — hard pass/fail gate for task completion.
  Use when asked to "check coverage", "verify UI tests", "coverage gate".
allowed-tools:
  - Bash
  - Read

---

# /uic-gate

```bash
UIC_BIN=$(bash ~/.claude/skills/uic/bin/find-uic.sh)
[ -z "$UIC_BIN" ] && echo "UIC not found. Install: git clone https://github.com/wilsonctr123/uic.git tool/ && cd tool && npm install && npm run build" && exit 1
```

Run `$UIC_BIN gate $ARGUMENTS`

Exit 0 = pass, exit 1 = fail, exit 2 = missing artifacts.

If gate passes: report coverage summary.
If gate fails: report EVERY blocking error. Do NOT proceed with task completion until gate passes.

**This gate is the source of truth. UI work is not done until this passes.**
