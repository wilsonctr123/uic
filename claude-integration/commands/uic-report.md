---
description: Display the latest UI coverage report
allowed-tools:
  - Bash
  - Read
argument-hint: "[--format json|text]"
---

Display the latest UIC coverage report.

1. Resolve and run:
```bash
UIC="node $(git rev-parse --show-toplevel)/tool/dist/cli.js"
$UIC report $ARGUMENTS
```

2. Report the coverage summary:
   - Surfaces tested / total (required count)
   - Flows tested / total (required count)
   - Invariants tested / total
   - Errors and warnings
   - Pass/fail status

3. If no report exists, tell the user to run `/uic-gate` first.
