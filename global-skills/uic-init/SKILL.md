---
name: uic-init
version: 2.1.0
description: |
  Bootstrap UIC in this project — detect framework, create uic.config.ts.
  Use when asked to "init uic", "setup uic", or "initialize browser testing".
allowed-tools:
  - Bash
  - Read

---

# /uic-init

```bash
UIC_BIN=$(bash ~/.claude/skills/uic/bin/find-uic.sh)
[ -z "$UIC_BIN" ] && echo "UIC not found. Install: git clone https://github.com/wilsonctr123/uic.git tool/ && cd tool && npm install && npm run build" && exit 1
```

Run `$UIC_BIN init $ARGUMENTS`

Report: detected framework, config path, next steps.
If config exists, suggest `--force` to overwrite.
