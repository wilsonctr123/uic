---
name: uic-contract-update
version: 2.1.0
description: |
  Apply inventory diff to the contract, preserving manual policy edits.
  Use when asked to "update contract", "apply UI changes to contract".
allowed-tools:
  - Bash
  - Read

---

# /uic-contract-update

```bash
UIC_BIN=$(bash ~/.claude/skills/uic/bin/find-uic.sh)
[ -z "$UIC_BIN" ] && echo "UIC not found. Install: git clone https://github.com/wilsonctr123/uic.git tool/ && cd tool && npm install && npm run build" && exit 1
```

Run `$UIC_BIN contract update`

Report what was added/removed/changed. If no changes needed, report up to date.
