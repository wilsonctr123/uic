---
description: Apply inventory diff to the contract, preserving manual policy edits
allowed-tools:
  - Bash
  - Read
---

Run the UIC contract update command to merge new discovery data into the existing contract.

1. Resolve and run:
```bash
UIC="node $(git rev-parse --show-toplevel)/tool/dist/cli.js"
$UIC contract update
```

2. After success, report:
   - What was added, removed, or changed
   - Path to updated contract: `.uic/contract.json`

3. If no changes needed, report that the contract is up to date.

4. If contract or inventory is missing, tell the user which `/uic-*` command to run first.
