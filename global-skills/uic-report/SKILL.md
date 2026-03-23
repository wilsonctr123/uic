---
name: uic-report
version: 2.1.0
description: |
  Display the latest UI coverage report.
  Use when asked to "show coverage", "coverage report", "what is tested".
allowed-tools:
  - Bash
  - Read

---

# /uic-report

```bash
UIC_BIN=$(bash ~/.claude/skills/uic/bin/find-uic.sh)
[ -z "$UIC_BIN" ] && echo "UIC not found. Install: git clone https://github.com/wilsonctr123/uic.git tool/ && cd tool && npm install && npm run build" && exit 1
```

Run `$UIC_BIN report $ARGUMENTS`

Report: surfaces/flows/invariants tested vs total, interaction coverage, errors, warnings.
Supports --format json for machine-readable output.
