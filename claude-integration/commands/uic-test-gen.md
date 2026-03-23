---
description: Generate Playwright test files from the UI coverage contract
allowed-tools:
  - Bash
  - Read
argument-hint: "[--output tests/e2e]"
---

Run the UIC test generation command to scaffold Playwright tests from the contract.

1. Resolve and run:
```bash
UIC="node $(git rev-parse --show-toplevel)/tool/dist/cli.js"
$UIC test gen $ARGUMENTS
```

2. After success, report:
   - Number of test files generated
   - Output directory path
   - Number of test cases per route

3. If no contract exists, tell the user to run `/uic-contract-gen` first.
