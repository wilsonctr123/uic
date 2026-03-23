---
name: uic-contract-gen
version: 2.1.0
description: |
  Generate a UI coverage contract from the latest discovery inventory.
  Use when asked to "generate contract", "create coverage contract".
allowed-tools:
  - Bash
  - Read

---

# /uic-contract-gen

```bash
UIC_BIN=$(bash ~/.claude/skills/uic/bin/find-uic.sh)
[ -z "$UIC_BIN" ] && echo "UIC not found. Install: git clone https://github.com/wilsonctr123/uic.git tool/ && cd tool && npm install && npm run build" && exit 1
```

Run `$UIC_BIN contract gen`

Report: surfaces, flows, invariants, exclusions, ledger accounting (discovered → accounted → unaccounted).
If no inventory, tell user to run /uic-discover first.
