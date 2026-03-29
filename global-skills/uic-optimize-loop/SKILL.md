---
name: uic-optimize-loop
version: 3.0.0
description: |
  Claude-powered test repair: diagnose failures, understand root causes,
  edit tests/fixtures/config, and rerun until pass rate reaches target.
  Use when asked to "fix failing tests", "optimize tests", "self-heal tests".
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Agent
---

# /uic-optimize-loop — Claude-Powered Deep Test Repair

```bash
UIC_BIN=$(bash ~/.claude/skills/uic/bin/find-uic.sh)
[ -z "$UIC_BIN" ] && echo "UIC not found." && exit 1
```

## Phase 1: Mechanical Repair

Run `$UIC_BIN optimize --iterations 3`

This handles pattern-matched repairs: ambiguous locators (.first()), self-navigation,
date formats, expected-401 filtering, wrong primitives.

## Phase 2: Assess Results

Read `.uic/generation-quality.json` and get the `pass_rate` from the last iteration.

If pass_rate >= 0.95 (95%), report success and stop.

## Phase 3: Claude-Driven Deep Repair

If pass_rate < 0.95, perform intelligent repair:

1. Read `.uic/repair-log.json` — find all failures where `autoApplied: false`
2. Run tests with JSON output: `npx playwright test --reporter=json 2>/dev/null`
3. Read the JSON output to get actual error messages for each failure

For EACH remaining failure:

a. **Read the test file** — understand what the test is trying to do
b. **Read the error message** — understand why it failed
c. **Determine root cause** — classify as one of:
   - **Test locator bug**: Element selector doesn't match the real UI → fix the selector
   - **Missing wait/timing**: Page not ready when test runs → add waitFor or waitForLoadState
   - **Wrong assertion**: Test asserts wrong thing (e.g., URL change when it's SPA) → fix assertion
   - **Missing precondition**: Test needs data/auth/fixture that doesn't exist → create it
   - **Backend not responding**: API call fails → check if services are configured in uic.config.ts
   - **Real app bug**: The app actually has a bug → mark test as blocked with reason, do NOT modify app code
d. **Apply the fix** using the Edit tool on the test file
e. Document what you changed and why

After fixing all failures in a batch:

3. Rerun tests: `npx playwright test`
4. Check pass rate
5. Repeat up to 3 deep iterations or until >= 95% pass rate

## Phase 3b: Output Judgment

For EVERY test (passing AND failing), verify the output is ACTUALLY correct:

1. Read the test file — what input was used? What assertion was made?
2. Read `.uic/observed-groups.json` — what DOM changes occurred for this interaction?
3. REASON about each test:
   - Was the interaction meaningful? (Did mutations occur? Network requests?)
   - Did the output contain a real response or just "no crash"?
   - Does the output make sense given the input?
   - Would a HUMAN looking at this page say "yes, this works"?
4. Score each test 0-10:
   - 0: Not attempted
   - 1-3: Interaction had no effect — PHANTOM TEST (passes but tests nothing)
   - 4-6: Something happened but output is unclear/weak
   - 7-8: Real interaction with meaningful output
   - 9-10: Full end-to-end verification with network + output validation
5. Write `.uic/test-judgments.json`:
   ```json
   [{ "testId": "...", "verdict": "pass|weak|fail", "score": 9, "reasoning": "..." }]
   ```
6. Flag any test scored <= 3 as a "phantom test" — it passes but tests nothing.
   Report these prominently in the summary.

## Phase 4: Quality Improvement Loop

Run `$UIC_BIN evidence` to get quality scores.

WHILE average quality < 9.5 AND iteration < 10:

1. Read `.uic/evidence-report.json` — find tests with quality < 7
2. For each weak test (up to 10):
   - Read the test file, observation data, and test plan
   - Diagnose: phantom? no network wait? timeout? weak assertion?
   - Fix: add `test.slow()`, `waitForResponse`, `expect.poll`, content checks
   - NEVER weaken — only strengthen
3. Re-run: `npx playwright test`
4. Re-score: `$UIC_BIN evidence`
5. Report: "Quality iteration N: X.X → Y.Y"
6. Exit if quality >= 9.5, stuck, or 10 iterations

If a strengthened test reveals an APP BUG (test correctly fails):
- Write a strong failing test with evidence
- Add to `.uic/app-bugs.json`
- Do NOT fix app code

## Phase 5: Final Summary

After all iterations:

1. Run `$UIC_BIN gate` — report final coverage
2. Summarize:
   - Starting pass rate → final pass rate
   - Starting quality → final quality
   - Mechanical repairs applied (count)
   - Claude repairs applied (list each with root cause)
   - Quality improvements (list each: test, before → after score)
   - App bugs found (if any, with evidence)
   - Remaining weak tests with explanations
   - Whether gate passed

## Rules

- NEVER modify application source code — only test files, fixtures, and UIC config
- NEVER weaken a test by just test.skip() — understand WHY it fails first
- If a test fails because of a real app bug, mark it blocked with a clear reason
- Always read the actual error before attempting a fix
- Prefer fixing the test over skipping it
