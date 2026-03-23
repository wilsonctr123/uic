# Coverage Gating

## How the Gate Works

`uic gate` compares three artifacts:
1. **Contract** (`.uic/contract.json`) — what must be tested
2. **Test results** (`.uic/test-results.json`) — what was tested
3. **Inventory** (`.uic/inventory.json`) — what currently exists

## Pass/Fail Logic

The gate **FAILS** (exit code 1) when:
- Required surfaces have no passing tests
- Required flows have no passing tests
- Required invariants are untested
- Major drift detected (new routes in inventory not in contract)

The gate **PASSES** (exit code 0) when:
- All required surfaces have passing tests
- All required flows have passing tests
- All required invariants are covered
- No blocking drift detected

## Strict Mode

`uic gate --strict` also fails on warnings (informational items without tests).

## Output

Human-readable summary to stdout:
```
============================================================
UIC COVERAGE GATE
============================================================

❌ FAILED — 3 errors, 2 warnings

🔴 ERRORS (blocking):
   • Required surface "search|user|desktop|initial" has no passing tests
   • Required flow "login-form" has no passing tests
   • Required invariant "auth-redirect" has no explicit test

🟡 WARNINGS (informational):
   • Surface "admin|admin|desktop|initial" has no tests
   • Route /admin in contract but not found in latest inventory

📊 Surfaces: 5/10 tested (8 required)
   Flows: 3/12 tested (8 required)
   Invariants: 2/4 tested
============================================================
```

Machine-readable report to `.uic/report.json`.

## Claude Code Integration

The `.claude/hooks/uic-gate.sh` script runs `uic gate` at task completion.
When the gate fails, Claude Code sees exactly what's missing and cannot
claim the task is done.

## Severity Levels

| Severity | Meaning | Blocks gate? |
|----------|---------|-------------|
| blocking | Must be tested | Yes (always) |
| warning | Should be tested | Only in --strict |
| info | Nice to have | Never |
