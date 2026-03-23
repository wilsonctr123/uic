---
description: Compare the current contract against the latest inventory to detect UI drift
allowed-tools:
  - Bash
  - Read
---

Run the UIC contract diff command to see what changed since the last contract generation.

1. Resolve and run:
```bash
UIC="node $(git rev-parse --show-toplevel)/tool/dist/cli.js"
$UIC contract diff
```

2. After success, report:
   - Added surfaces and flows
   - Removed surfaces and flows
   - Changed surfaces (element count changes)
   - Whether an update is recommended

3. If contract or inventory is missing, tell the user which `/uic-*` command to run first.
