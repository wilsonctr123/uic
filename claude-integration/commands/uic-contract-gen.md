---
description: Generate a UI coverage contract from the latest discovery inventory
allowed-tools:
  - Bash
  - Read
---

Run the UIC contract generation command. Requires a prior `/uic-discover` run.

1. Resolve and run:
```bash
UIC="node $(git rev-parse --show-toplevel)/tool/dist/cli.js"
$UIC contract gen
```

2. After success, report:
   - Number of surfaces in the contract
   - Number of flows generated
   - Number of invariants
   - Path to the contract: `.uic/contract.json`

3. If no inventory exists, tell the user to run `/uic-discover` first.

4. If the command fails, report the exact error.
