---
name: uic-contract-diff
version: 2.1.0
description: |
  Compare the current contract against the latest inventory to detect UI drift.
  Use when asked to "check drift", "what changed in UI".
allowed-tools:
  - Bash
  - Read

---

# /uic-contract-diff

```bash
UIC_BIN=$(bash ~/.claude/skills/uic/bin/find-uic.sh)
[ -z "$UIC_BIN" ] && echo "UIC not found. Install: git clone https://github.com/wilsonctr123/uic.git tool/ && cd tool && npm install && npm run build" && exit 1
```

Run `$UIC_BIN contract diff`

Report: added/removed/changed surfaces and flows, whether update is recommended.
If contract or inventory missing, tell user which command to run first.
