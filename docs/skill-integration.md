# Claude Code Skill Integration

UIC integrates with Claude Code through two mechanisms:

## 1. Custom Slash Commands

UIC provides 10 slash commands installed in `.claude/commands/`:

| Command | Purpose |
|---------|---------|
| `/uic-init` | Bootstrap UIC in the project |
| `/uic-doctor` | Verify setup and dependencies |
| `/uic-discover` | Run browser discovery |
| `/uic-contract-gen` | Generate contract from inventory |
| `/uic-contract-diff` | Detect UI drift |
| `/uic-contract-update` | Apply drift to contract |
| `/uic-test-gen` | Generate Playwright tests |
| `/uic-test-run` | Execute tests |
| `/uic-gate` | Coverage check (pass/fail) |
| `/uic-report` | Display coverage report |

Each command is a thin wrapper that calls the UIC CLI tool. No business logic
lives in the commands — they only handle UX (summarizing output, suggesting
next steps, explaining failures).

## 2. Completion Gate Hook

The `.claude/settings.json` file wires a PostToolUse hook on `TaskComplete`:

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

This prevents Claude from completing UI-affecting tasks without browser verification.

## 3. Typical Workflow

```
User: "Add a search filter to the Tasks page"

Claude:
1. Implements the filter in React code
2. Runs /uic-discover (rediscovers the UI)
3. Runs /uic-contract-update (updates contract with new elements)
4. Runs /uic-test-gen (regenerates tests)
5. Runs /uic-test-run (executes Playwright tests)
6. Runs /uic-gate (verifies coverage)
7. Only completes if gate passes
```

## 4. Reusable Skill Package

The `skill/` directory contains a reusable skill package:
- `SKILL.md` — orchestration instructions
- `scripts/bootstrap.sh` — first-time setup
- `scripts/maintain.sh` — update workflow
- `agents/openai.yaml` — Codex review integration
- `references/` — schema documentation
