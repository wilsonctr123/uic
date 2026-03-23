---
name: uic-test-gen
version: 2.1.0
description: |
  Generate Playwright test files from the UI coverage contract and affordance ledger.
  Use when asked to "generate tests", "create e2e tests", "scaffold tests".
allowed-tools:
  - Bash
  - Read

---

# /uic-test-gen

```bash
UIC_BIN=$(bash ~/.claude/skills/uic/bin/find-uic.sh)
[ -z "$UIC_BIN" ] && echo "UIC not found. Install: git clone https://github.com/wilsonctr123/uic.git tool/ && cd tool && npm install && npm run build" && exit 1
```

Run `$UIC_BIN test gen $ARGUMENTS`

Report: test files generated, interaction vs smoke vs blocked counts.
If no contract/ledger, tell user to run /uic-contract-gen first.
