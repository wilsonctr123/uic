---
description: Check UI coverage against contract — pass/fail gate for task completion
allowed-tools:
  - Bash
  - Read
argument-hint: "[--strict]"
---

Run the UIC coverage gate to verify that required UI coverage is met.

This is the hard enforcement gate. It compares:
- The UI contract (required surfaces, flows, invariants)
- Test results from the last `/uic-test-run`
- The latest inventory from `/uic-discover`

1. Resolve and run:
```bash
UIC="node $(git rev-parse --show-toplevel)/tool/dist/cli.js"
$UIC gate $ARGUMENTS
```

2. If the gate **passes** (exit 0): report the coverage summary.

3. If the gate **fails** (exit 1): report every blocking error. List exactly what is missing or failing. Do NOT proceed with task completion until the gate passes.

4. If artifacts are missing (exit 2): tell the user exactly which `/uic-*` commands to run.

**This gate is the source of truth for UI coverage. A task that affects UI is not done until this passes.**
