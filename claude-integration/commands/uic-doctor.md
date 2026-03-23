---
description: Verify UIC setup — check config, Playwright, and artifact status
allowed-tools:
  - Bash
  - Read
---

Run the UIC doctor command to check the health of the UI testing setup.

1. Resolve and run:
```bash
UIC="node $(git rev-parse --show-toplevel)/tool/dist/cli.js"
$UIC doctor
```

2. Report the status of each check (config, Playwright, inventory, contract, test results, report).

3. If any checks fail, tell the user exactly what command to run to fix it.
