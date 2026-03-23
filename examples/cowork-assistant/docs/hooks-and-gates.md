# UIC Hooks and Gates

## Architecture

```
Claude Code Task Completion
        │
        ▼
.claude/settings.json (PostToolUse hook)
        │
        ▼
node tool/dist/cli.js gate
        │
        ├── Reads .uic/contract.json (required surfaces/flows)
        ├── Reads .uic/test-results.json (test outcomes)
        ├── Reads .uic/inventory.json (latest discovery)
        │
        ▼
   Pass (exit 0) or Fail (exit 1)
```

## Hook Configuration

In `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "TaskComplete",
      "hooks": [{
        "type": "command",
        "command": "node ./tool/dist/cli.js gate 2>/dev/null || echo 'UIC: run /uic-discover && /uic-test-run && /uic-gate'",
        "timeout": 30000
      }]
    }]
  }
}
```

## Gate Script

`.claude/hooks/uic-gate.sh` is a thin adapter:
- Finds the UIC tool (local build or global install)
- Runs `uic gate` with any passed arguments
- Returns the gate's exit code

## What the Gate Checks

1. **Required surfaces tested** — every surface with `policy.required: true` and `severity: "blocking"` must have passing tests
2. **Required flows tested** — every flow with `required: true` must have passing tests
3. **Invariants tested** — no-console-errors, auth-redirect, etc.
4. **Drift detection** — routes in inventory but not contract (warning), routes in contract but not inventory (warning)

## Failure Output

When the gate fails, it produces:
- 🔴 ERRORS (blocking) — must be fixed before completion
- 🟡 WARNINGS — informational, don't block unless `--strict`
- 📊 Summary — surfaces/flows/invariants tested vs required

## Machine-Readable Report

Every gate run writes `.uic/report.json` with:
- `passed: boolean`
- `summary: { errors, warnings, surfaces_tested, ... }`
- `issues: [{ type, severity, item, message }]`
