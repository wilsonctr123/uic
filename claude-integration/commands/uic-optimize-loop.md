---
description: Diagnose test failures, repair tests/fixtures/seeds, and rerun until pass rate reaches 100%
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Agent
  - WebSearch
  - WebFetch
argument-hint: "[--allow-app-fixes] [--max-iterations 3]"
---

Run the UIC optimize loop to diagnose and fix all test failures.

This is the self-healing engine. It reads test results, classifies each failure into 4 layers, and applies repairs:

- **Layer A** (test defects): fixes locators, assertions, guards — auto-applied
- **Layer B** (precondition defects): generates missing fixtures, seeds data, fixes auth — auto-applied
- **Layer C** (expected runtime): adjusts for known behaviors (401s, self-nav, LLM timeout) — auto-applied
- **Layer D** (app defects): diagnoses app bugs — only applied with `--allow-app-fixes`

## Procedure

```bash
UIC="node $(git rev-parse --show-toplevel)/tool/dist/cli.js"
```

### Step 1: Read current test results
Read `.uic/test-results.json` and `.uic/ledger.json`. Count pass/fail.
If no test results exist, tell the user to run `/uic-test-run` first.

### Step 2: Diagnose all failures
For each failing test:
1. Read the error message from test results
2. Classify into Layer A/B/C/D using the diagnoser patterns
3. Determine confidence, repair target, and repair type
4. Log the diagnosis

### Step 3: Synthesize missing preconditions (Layer B)
For any Layer B failures (missing fixture, seed data, auth):
1. Spawn a subagent to generate the required fixture files
2. Use the retrieval hierarchy: repo asset → synthesize → derive → web fetch
3. Log every generated precondition in `.uic/preconditions.json`
4. Cache any web-fetched samples locally with provenance

### Step 4: Apply repairs (Layers A, B, C)
For each diagnosed failure with confidence >= 0.7:
1. Edit the test file to fix the issue
2. For ambiguous locators: use `.first()`, `{ exact: true }`, or contextual locator
3. For dynamic labels: try stronger locator first (Rule 3), only then downgrade
4. For self-navigation: replace URL assertion with meaningful UI state assertion (Rule 4)
5. For disabled elements: add `.isEnabled()` guard before interaction
6. For date inputs: use ISO format `2026-01-15`
7. For expected 401s: filter from console error assertion
8. For LLM timeout: use graceful assertion that verifies UI entered submitting state
9. Log each repair with confidence and type

### Step 5: Diagnose app bugs (Layer D)
For each Layer D failure:
1. Read the error + screenshot
2. Identify the source file and root cause
3. If `--allow-app-fixes` is passed AND confidence >= 0.8:
   - Apply the fix
   - Run targeted rerun to verify
   - Log the repair
4. Otherwise: log the diagnosis as a proposed fix without applying

### Step 6: Targeted rerun
After repairs, rerun only the affected tests first (Rule 8):
```bash
npx playwright test --grep "test-title-pattern"
```

### Step 7: Full suite rerun
At end of iteration, run the full test suite:
```bash
$UIC test run
```

### Step 8: Quality check
After each iteration:
1. Count pass rate, interaction coverage, blocked count, weakened count
2. Check hard gate rules (Rule 10):
   - unaccounted affordances = 0
   - no silent downgrades
   - no weakening-only improvement
3. If pass rate = 100% and all rules pass → DONE
4. If iteration < max_iterations → go to Step 2
5. If stuck (same failures 2 iterations in a row) → report and stop

### Step 9: Report
After all iterations, report:
- Final pass rate
- Repairs applied by layer (A/B/C/D)
- Fixtures generated
- Weakened assertions (if any, with justification)
- Coverage removals (should be 0)
- Remaining failures with diagnoses
- Files modified (test + app)
- Obligation integrity metrics

Write artifacts:
- `.uic/repair-log.json`
- `.uic/generation-quality.json`
- `.uic/preconditions.json`

## Hard Rules (enforced by this command)

1. **No silent skips.** Every failure gets a diagnosis.
2. **No fake coverage.** TODO stubs don't count. Weakened assertions are logged.
3. **No disappearing obligations.** Blocking count tracked before/after.
4. **Downgrade resistance.** Try 4 locator strategies before marking informational.
5. **App edits opt-in.** Layer D fixes only with `--allow-app-fixes`.
6. **Targeted reruns first.** Don't rerun 130+ tests for every fix.
