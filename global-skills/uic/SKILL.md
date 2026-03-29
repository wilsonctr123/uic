---
name: uic
version: 3.0.0
description: |
  Run the full UIC browser-first testing pipeline in one shot.
  Auto-detects bootstrap (first run) vs maintain (existing contract) mode.
  Starts all services, seeds data, tests real user journeys, and uses
  Claude-powered deep repair when mechanical fixes aren't enough.
  Use when asked to "run uic", "test the UI", "browser test", "uic", or
  "generate UI tests".
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Agent
---

# /uic — Self-Sufficient UI Testing Pipeline

## Find the CLI

```bash
UIC_BIN=$(bash ~/.claude/skills/uic/bin/find-uic.sh)
if [ -z "$UIC_BIN" ]; then
  echo "UIC not found. Install: git clone https://github.com/wilsonctr123/uic.git ~/.uic-tool && cd ~/.uic-tool && npm install && npm run build"
  exit 1
fi
echo "Using: $UIC_BIN"
```

## Auto-detect mode

If no argument given:
- If `.uic/contract.json` does NOT exist → **bootstrap**
- If `.uic/contract.json` exists → **maintain**

---

## Bootstrap mode

1. If no `uic.config.ts`, run `$UIC_BIN init` and report detected stack.
   **Review the generated config.** If the app has a backend (check for pyproject.toml,
   package.json scripts, docker-compose.yml, vite proxy config), add a `services` array
   to uic.config.ts with both backend and frontend services.

2. Run `$UIC_BIN doctor` — if it fails, report what's missing and stop.

3. Run `$UIC_BIN discover --persona user` — report route/element counts.
   The CLI handles pre-flight checks, service startup, auth, and seeding automatically.

4. **CRITICAL: Check discovery output for degradation warnings.**
   After discover, read the output. If you see "DEGRADED DISCOVERY DETECTED" or
   auth failed or only 1 route discovered when more are expected:
   - **Diagnose the issue.** Read the app's code to understand what's wrong.
   - Is the backend not configured in `services`? Add it.
   - Is auth failing? Check credentials in `.env`, check the auth strategy.
   - Are routes missing? Add more `seedRoutes` to discovery config.
   - **Fix the config and re-run discover.** Do NOT proceed with degraded data.

5. **PAGE UNDERSTANDING (Claude reasons about the app)**

   Read `.uic/inventory.json`. For each route and interaction group, REASON:

   - **What is this page FOR?** Read element labels, placeholders, route name.
     Don't just see "input with placeholder 'Ask'" — understand "this is an AI-powered
     search interface that queries the user's email and document corpus."
   - **What would a REAL user do?** Think about the app's purpose. Not "type Hello" —
     a real query like "What emails did I get about the Q4 budget proposal?"
   - **What inputs would STRESS TEST this feature?** Long queries, edge cases,
     ambiguous requests that test the app's intelligence.
   - **What should a GOOD output look like?** For a chat: AI response with citations.
     For a search: results list with relevant items. For a form: success confirmation.
   - **What PREREQUISITES are needed?** Does the user need to click "New" before
     the input works? Does a modal need to be opened? Does a tab need to be selected?

   Write `.uic/test-plan.json`:
   ```json
   {
     "groups": [{
       "groupId": "/chat:group:0",
       "route": "/chat",
       "pageUnderstanding": "AI-powered assistant for querying emails and documents",
       "prerequisites": ["Click '+ New conversation' to start a session"],
       "testInputs": [
         { "input": "What emails about Q4 budget?", "reasoning": "Tests agentic search", "expectedBehavior": "AI response with citations" }
       ],
       "successIndicators": ["Response > 20 chars", "No error patterns", "Citations present"],
       "failureIndicators": ["Error message", "Empty response", "Loading stuck"]
     }]
   }
   ```

   **Rules for test inputs:**
   - NEVER use "Hello", "test", or generic strings
   - Read the placeholder text and page context to understand what input is expected
   - Generate inputs that would exercise the CORE FUNCTIONALITY of the page
   - If the page has an AI/chat feature, ask a REAL question that tests the AI
   - If the page has search, search for something that would exist in test data
   - If the page has a form, fill with realistic data that tests validation

6. Run `$UIC_BIN contract gen` — report surface/flow/invariant counts + ledger.

7. Run `$UIC_BIN test gen` — report test file count.

8. If `journeys` are defined in config, run `$UIC_BIN journey gen` — report journey count.

9. Run `$UIC_BIN observe` — observe live DOM changes for interaction groups.
   The observer now has prerequisite discovery — if an interaction has no effect,
   it automatically tries clicking visible buttons first.
   Reports: groups found, patterns, prerequisites discovered, mutations, composite tests.

10. Run `$UIC_BIN test run` — report pass/fail counts.

11. Run `$UIC_BIN optimize --iterations 3` — mechanical repair pass.

12. Run `$UIC_BIN evidence` — generate initial evidence report with quality scores.

13. **QUALITY IMPROVEMENT LOOP — Fix every weak test until quality >= 9.5**

    Read `.uic/evidence-report.json`. Get `summary.averageQuality`.

    WHILE average quality < 9.5 AND iteration < 10:

    **13a. Identify weak tests**
    Find all tests with quality score < 7 from the evidence report.

    **13b. Diagnose each weak test** (up to 10 per iteration)
    For each weak test:
    1. READ the test file — what does it do? What assertions does it have?
    2. READ `.uic/observed-groups.json` — find observation data for this route
    3. READ `.uic/test-plan.json` — get expected behavior and success indicators
    4. READ the app source code if needed — find API endpoints, understand the feature
    5. Apply the diagnosis decision tree IN ORDER:

    | Diagnosis | Signals | Fix |
    |-----------|---------|-----|
    | **A: Phantom** (1-3) | 0 mutations, 0 network, output unchanged | Add prerequisite + output assertion |
    | **B: No Network Wait** (4-6) | Observation has networkRequests but test has no waitForResponse | Add `waitForResponse` with observed API URL |
    | **C: Output Unchanged** (2-4) | mutations>0 but output identical | Find correct output selector |
    | **D: Timeout Too Short** (3-5) | settleTime>8s or timeout error | Add `test.slow()` + 30s+ wait |
    | **E: Weak Assertion** (5-6) | Output changed but test only asserts toBeVisible | Add content length + error pattern checks |
    | **F: Dynamic Content** (3-5) | Uses waitForTimeout instead of polling | Replace with `expect.poll` or `waitForSelector` |

    **13c. Fix each diagnosed test**
    Apply the fix using Edit tool. Rules:
    - Add `test.slow()` for any AI/LLM-backed feature
    - Use `Promise.all([page.waitForResponse(...), click()])` for API waits
    - Use `expect.poll(() => text.length, { timeout: 30000 })` for async content
    - Add `expect(text).not.toMatch(/error|failed|exception/i)` for error detection
    - Add `expect(text!.length).toBeGreaterThan(20)` for content verification
    - Read app source to find actual API endpoints (e.g., `/api/v1/chat/sessions/*/query`)
    - NEVER weaken a test — only strengthen it
    - NEVER skip a test during quality improvement

    **13d. Re-run and re-score**
    ```bash
    npx playwright test
    $UIC_BIN evidence
    ```
    Report: "Quality loop iteration N: average quality X.X → Y.Y"

    **13e. Check exit conditions**
    - quality >= 9.5 → SUCCESS, exit loop
    - iteration >= 10 → BUDGET EXHAUSTED, exit
    - quality improved < 0.5 → STUCK, exit
    - remaining weak tests all diagnosed as app bugs → exit

    **13f. Test bug vs app bug**
    After strengthening a test:
    - If it PASSES with quality 7+ → test bug, now fixed
    - If it FAILS with meaningful output → APP BUG. Write a STRONG test that
      correctly detects the bug. Add to `.uic/app-bugs.json` with evidence.
      Do NOT fix app code — that requires user approval.

14. **IRON RULE GATE — deterministic, non-negotiable**

    Run: `$UIC_BIN gate --quality-threshold 9.5`

    If this exits with code 1, YOU HAVE NOT FINISHED. This is deterministic code.
    Do NOT report success. Do NOT summarize. Continue fixing.
    Go back to step 13a and fix more tests.

15. **ADVERSARIAL TESTING (Codex) — if available**

    Check: `which codex`
    If codex is available:
    a. Read `.uic/inventory.json` and existing tests
    b. Build adversarial context: routes, inputs, API endpoints
    c. Run codex to generate 15-20 adversarial tests:
       - Input fuzzing: empty, 10K chars, SQL injection, XSS, Unicode
       - State violations: wrong-order actions, double-submit, mid-navigation
       - Concurrency: rapid-fire, parallel operations
       - Error recovery: network failures, timeouts
       - Auth edge cases: expired sessions, cleared cookies
    d. Write to `tests/e2e/adversarial.spec.ts`
    e. Run tests twice (flakiness filter)
    f. Report bugs found in `.uic/adversarial-findings.json`
    g. Adversarial failures are APP BUGS — report but do not block gate
    If codex not available: skip with message.

16. Run `$UIC_BIN evidence` — generate final evidence report.

17. Read and display `.uic/evidence-report.md` — the full per-test breakdown.

## IRON RULES — Quality Gate (non-negotiable)

The quality gate at step 14 is DETERMINISTIC CODE that cannot be argued with.

**NOT acceptable reasons to stop before gate passes:**
- "Primitives are capped at 6" → WRONG. Replace with composite tests scoring 9+.
- "Click tests appropriately score low" → WRONG. Add waitForResponse, expect.poll, content checks.
- "Quality cannot improve further" → WRONG unless ALL weak tests are PROVEN app bugs.
- "This is good enough" → the gate is binary. 9.5 or fail. No exceptions.
- "Observation data shows low quality" → WRONG. The evidence reporter now scores from
  actual test code. Re-run `$UIC_BIN evidence` to get updated scores.

**Escalation when stuck (quality plateaus after 3 iterations):**
1. Replace ALL primitive tests scoring < 7 with composite equivalents
2. Re-observe: `$UIC_BIN observe`
3. Re-generate evidence: `$UIC_BIN evidence`
4. Re-run gate: `$UIC_BIN gate --quality-threshold 9.5`

## Quality Improvement Rules

- Never downgrade a test — only strengthen assertions
- Always re-run after editing — never assume fix worked
- Max 10 tests per iteration, max 10 iterations
- Read app source code to understand API endpoints
- Use `test.slow()` for AI/LLM features
- Prefer `waitForResponse` and `expect.poll` over `waitForTimeout`
- When adding `waitForResponse`, put it BEFORE the click using `Promise.all`

## App Bug Reporting

When a strengthened test reveals an app bug (test correctly fails):
- Write a STRONG test that detects the bug with clear assertions
- Add to `.uic/app-bugs.json`:
  ```json
  { "route": "/chat", "test": "...", "expected": "AI response with citations",
    "actual": "Error: service unavailable", "screenshot": ".uic/screenshots/..." }
  ```
- Do NOT fix app code during UIC run — that requires user approval

## Maintain mode

1. Run `$UIC_BIN discover --persona user` — report what changed.
   (Services, auth, and seeding handled automatically by CLI.)

2. Run `$UIC_BIN contract diff` — report drift summary.

3. Run `$UIC_BIN contract update` — report what was updated.

4. Run `$UIC_BIN test gen` — report regenerated test count.

5. If journeys defined, run `$UIC_BIN journey gen`.

6. Run `$UIC_BIN test run` — report pass/fail.

7. Run `$UIC_BIN optimize --iterations 3` — mechanical repair.

8. If pass rate < 95%: Claude-driven deep repair (same as bootstrap step 10).

9. Run `$UIC_BIN gate` — report final result.

## Status mode

1. Run `$UIC_BIN doctor` — report setup.
2. Run `$UIC_BIN gate` — report coverage.

## Rules

- Stop on any command failure and report which step failed.
- Services are auto-started by discover and test run (via config).
- If discovery finds fewer routes than expected, investigate before proceeding.
- After mechanical optimize, ALWAYS check pass rate and run deep repair if < 95%.
- After the final gate, give a concise summary.
- This is a LOCAL system — you have full control. Start backends, create accounts,
  seed data. No excuses about "backend not running" or "auth failed."
