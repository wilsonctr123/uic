# UIC Skill Design

## Purpose

The UIC Claude Code skill provides ergonomic slash commands that wrap the
deterministic UIC CLI tool. The skill handles UX concerns (summarizing output,
suggesting next steps) while the CLI handles all logic.

## Architecture

```
Slash Commands (.claude/commands/uic-*.md)
    │
    ▼
UIC CLI (node tool/dist/cli.js)
    │
    ├── Discovery → .uic/inventory.json
    ├── Contract  → .uic/contract.json
    ├── Tests     → tests/e2e/*.spec.ts
    └── Gate      → .uic/report.json (exit 0/1)
```

## Design Principles

1. **Commands are thin wrappers** — no business logic in slash commands
2. **CLI is deterministic** — same input always produces same output
3. **Hook is enforcement** — thin adapter calling the CLI gate
4. **Config is project-specific** — all per-repo details in uic.config.ts
5. **Skill is reusable** — works across any webapp repo

## What Lives Where

| Concern | Location | Deterministic? |
|---------|----------|---------------|
| Framework detection | tool/src/config/detector.ts | Yes |
| Browser discovery | tool/src/discovery/crawler.ts | Yes |
| Contract generation | tool/src/contract/generator.ts | Yes |
| Coverage checking | tool/src/gate/checker.ts | Yes |
| Auth abstraction | tool/src/auth/persona.ts | Yes |
| Test generation | tool/src/runner/test-generator.ts | Yes |
| Result summarization | .claude/commands/uic-*.md | No (UX) |
| Next step suggestions | .claude/commands/uic-*.md | No (UX) |
| Multi-step orchestration | skill/scripts/*.sh | No |

## Reusability

To use UIC in a new repo:
1. Copy or install the `tool/` package
2. Run `/uic-init` to generate project config
3. Copy `.claude/commands/uic-*.md` for slash commands
4. Copy `.claude/hooks/uic-gate.sh` for enforcement
5. Edit `uic.config.ts` with project-specific details

The skill package (`skill/`) contains everything needed for steps 2-5.
