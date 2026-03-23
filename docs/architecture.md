# UIC Architecture

## Layer Separation

```
┌─────────────────────────────────┐
│       Claude Code Skill         │  Orchestration layer
│  (bootstrap / maintain / report)│  Calls UIC CLI commands
├─────────────────────────────────┤
│         UIC CLI Tool            │  Generalized core
│  (discover / contract / gate)   │  npm-publishable package
├─────────────────────────────────┤
│       Project Config            │  Per-repo adapter
│     (uic.config.ts)             │  App-specific details
├─────────────────────────────────┤
│      Repo-Local Hooks           │  Enforcement plane
│  (.claude/hooks/uic-gate.sh)    │  Thin adapter → UIC gate
└─────────────────────────────────┘
```

## What Goes Where

| Concern | Location | Example |
|---------|----------|---------|
| Browser crawling logic | tool/src/discovery/ | Element detection, page crawling |
| Contract schema/generation | tool/src/contract/ | JSONC generation, diff algorithm |
| Coverage checking | tool/src/gate/ | Contract vs results comparison |
| Auth strategies | tool/src/auth/ | Persona abstraction, 4 strategies |
| CLI commands | tool/src/cli.ts | uic init, discover, gate, etc. |
| App start command | uic.config.ts | `cd web && npm run dev` |
| Seed routes | uic.config.ts | `['/login', '/', '/chat']` |
| Auth credentials | uic.config.ts + env vars | `${TEST_USER_EMAIL}` |
| Exclusions | uic.config.ts | WebSocket, dynamic routes |
| Hook wiring | .claude/settings.json | PostToolUse → uic gate |
| Skill orchestration | skill/SKILL.md | Bootstrap/maintain workflows |

## Data Flow

```
uic discover
  ↓
  Playwright crawls running app
  ↓
  .uic/inventory.json (discovered elements)
  ↓
uic contract gen
  ↓
  .uic/contract.json (coverage requirements)
  ↓
uic test gen
  ↓
  tests/e2e/*.spec.ts (Playwright tests)
  ↓
uic test run
  ↓
  .uic/test-results.json (Playwright JSON results)
  ↓
uic gate
  ↓
  .uic/report.json (pass/fail + issues)
  ↓
  Exit code 0 (pass) or 1 (fail)
```

## Auth Architecture

```
uic.config.ts
  auth.strategy: 'api-bootstrap'
  auth.personas:
    user: { email, password, loginEndpoint }
    admin: { email, password, loginEndpoint }
    guest: {}
        ↓
  PersonaFactory selects strategy
        ↓
  ┌─────────────────┬──────────────────┬──────────────────┬────────────┐
  │ storage-state   │ ui-flow          │ api-bootstrap    │ custom     │
  │ Import saved    │ Drive login UI   │ POST to login    │ User hook  │
  │ cookies/state   │ once, cache      │ API, inject      │ module     │
  └─────────────────┴──────────────────┴──────────────────┴────────────┘
        ↓
  Authenticated BrowserContext
        ↓
  .uic/auth/{persona}.json (cached, gitignored)
```

## Generalization Target

- **80% reusable core**: Discovery, contracts, gate, CLI, schemas
- **20% per-project config**: Routes, auth, exclusions, start command
- **0% hardcoded**: No app-specific logic in tool/src/
