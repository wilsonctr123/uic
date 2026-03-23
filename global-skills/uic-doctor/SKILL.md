---
name: uic-doctor
version: 2.1.0
description: |
  Verify UIC setup — check config, Playwright, and artifact status.
  Use when asked to "check uic", "uic status", or "verify testing setup".
allowed-tools:
  - Bash
  - Read

---

# /uic-doctor

```bash
UIC_BIN=$(bash ~/.claude/skills/uic/bin/find-uic.sh)
[ -z "$UIC_BIN" ] && echo "UIC not found. Install: git clone https://github.com/wilsonctr123/uic.git tool/ && cd tool && npm install && npm run build" && exit 1
```

Run `$UIC_BIN doctor`

Report status of each check. If any fail, tell user exactly what to fix.
