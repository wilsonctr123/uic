---
name: uic-discover
version: 2.1.0
description: |
  Crawl the webapp with a real browser and inventory all interactive UI elements.
  Auto-starts the dev server. Use when asked to "discover UI", "crawl app", or "find all buttons".
allowed-tools:
  - Bash
  - Read
  - Edit
---

# /uic-discover

```bash
UIC_BIN=$(bash ~/.claude/skills/uic/bin/find-uic.sh)
[ -z "$UIC_BIN" ] && echo "UIC not found. Install: git clone https://github.com/wilsonctr123/uic.git tool/ && cd tool && npm install && npm run build" && exit 1
```

Run `$UIC_BIN discover $ARGUMENTS`

The tool auto-starts the dev server using startCommand from uic.config.ts.

Report: routes discovered, element counts, inventory path, console errors, unreachable routes.
If auth fails, suggest setting TEST_USER_EMAIL and TEST_USER_PASSWORD in .env.
