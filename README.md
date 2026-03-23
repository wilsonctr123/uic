# UIC — Browser-First UI Coverage Enforcement

**The QA stabilization system that prevents AI agents and developers from claiming UI work is done when only backend checks passed.**

UIC crawls your webapp with a real browser, discovers every interactive control, generates real interaction tests (not visibility checks), and self-heals failing tests until 100% pass rate.

## The Problem

AI coding agents (Claude, Copilot, Codex) routinely verify UI work by:
- Running unit tests
- Checking API responses
- Inspecting source code
- Reading component renders

None of these prove the UI actually works in a browser. UIC closes that gap.

## What Makes UIC Different

| Traditional E2E tools | UIC |
|----------------------|-----|
| You write all tests manually | Tests auto-generated from browser discovery |
| Visibility checks (`toBeVisible`) | Real interactions (click, fill, toggle, upload) |
| Tests break silently on UI changes | Drift detection + contract updates |
| No coverage accounting | Every discovered element explicitly accounted for |
| Tests can be skipped silently | Zero unaccounted elements enforced |
| Fixtures created manually | Preconditions auto-synthesized |
| Failures require manual diagnosis | 4-layer auto-diagnosis + repair |

## Quick Start

### One command does everything:

```bash
/uic
```

That's it. UIC auto-detects your stack, starts your dev server, crawls every page, generates tests, runs them, diagnoses failures, repairs them, and reports coverage.

### Or step by step:

```bash
uic init              # Detect framework, create config
uic discover          # Crawl app with real browser (auto-starts server)
uic contract gen      # Generate coverage contract + affordance ledger
uic test gen          # Generate real Playwright interaction tests
uic test run          # Execute tests (auto-starts server)
uic optimize          # Diagnose failures, repair, rerun until 100%
uic gate              # Final coverage check — exit 0 or 1
```

## Installation

### In your project:

```bash
# Install Playwright
npm install -D @playwright/test
npx playwright install chromium

# Clone or copy the tool
cp -r tool/ your-project/tool/
cd tool && npm install && npm run build
```

### Create config:

```bash
node tool/dist/cli.js init
```

This auto-detects your framework (React, Vue, Svelte, Angular, Next.js, Nuxt, SvelteKit) and generates `uic.config.ts`.

### Set credentials:

Create `.env` in your project root:
```
TEST_USER_EMAIL=your-test-user@example.com
TEST_USER_PASSWORD=your-test-password
```

UIC reads `.env` automatically. Credentials are never committed (`.env` is gitignored).

## How It Works

### 1. Discovery

UIC launches a headless Chromium browser, authenticates as your test user, and crawls every seed route. For each page, it extracts every interactive element:

- Buttons, links, inputs, textareas, selects
- File uploads, checkboxes, toggles
- Tables, dialogs, forms, tabs, menus
- Their roles, labels, selectors, and states

Output: `.uic/inventory.json`

### 2. Affordance Classification

Each discovered element becomes an **affordance** — a unit of interaction with:

- **Action**: what you do to it (click, fill, toggle, upload, navigate, select)
- **Oracle**: what should happen (URL changes, element appears, attribute changes, network fires)
- **Disposition**: executable, blocked (with reason), informational, or excluded

No element disappears silently. The ledger accounts for every single one.

Output: `.uic/ledger.json`

### 3. Test Generation

Each executable affordance gets a **real Playwright test** that performs the action and asserts the oracle. Not a visibility check. Not a TODO stub.

```typescript
// Real test: click Ask button → navigates to /chat
test('home:button:ask: click Ask', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /ask/i }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: /ask/i }).click();
  // Assert: attribute-changes (mode chip activation)
  await page.waitForTimeout(300);
});
```

Widget adapters handle special cases:
- **Chips** — inline styles, not CSS classes
- **File uploads** — `setInputFiles()`, not drag-drop
- **Chat inputs** — Enter-to-submit behavior
- **Date inputs** — ISO format

Output: `tests/e2e/*.spec.ts`

### 4. Self-Healing Optimize Loop

When tests fail, UIC diagnoses each failure into 4 layers:

| Layer | What | Fix |
|-------|------|-----|
| **A** | Test defects (bad locator, wrong assertion) | Auto-fix the test |
| **B** | Precondition defects (missing fixture, no seed data) | Auto-generate fixtures |
| **C** | Expected runtime (guest 401, slow LLM, self-nav) | Adjust assertion |
| **D** | Real app bugs (JS exception, API 500) | Diagnose + propose fix |

Layers A/B/C are auto-repaired. Layer D requires `--allow-app-fixes`.

The loop iterates up to 3 times or until 100% pass rate.

Output: `.uic/repair-log.json`, `.uic/generation-quality.json`

### 5. Coverage Gate

The gate is binary: every blocking executable affordance must have a passing test. No percentages, no thresholds to game.

The gate fails if:
- Any required interactive control lacks a passing test
- Unaccounted affordances > 0
- Blocking obligations silently decreased
- Coverage improved only by weakening tests

Output: `.uic/report.json`

## CLI Commands

| Command | Description |
|---------|-------------|
| `uic init` | Detect framework, create `uic.config.ts` |
| `uic doctor` | Verify setup: config, Playwright, artifacts |
| `uic discover` | Crawl app with real browser (auto-starts server) |
| `uic contract gen` | Generate contract + affordance ledger |
| `uic contract diff` | Compare contract vs latest inventory (drift detection) |
| `uic contract update` | Apply diff, preserving manual policy edits |
| `uic test gen` | Generate Playwright interaction tests from ledger |
| `uic test run` | Execute tests (auto-starts server) |
| `uic optimize` | Diagnose → repair → rerun loop (up to 3 iterations) |
| `uic gate` | Coverage check — exit 0 (pass) or 1 (fail) |
| `uic report` | Display latest coverage report |

## Claude Code Integration

UIC includes 12 slash commands for Claude Code:

| Command | What It Does |
|---------|-------------|
| `/uic` | Full pipeline in one shot (bootstrap or maintain) |
| `/uic-init` | Detect framework, create config |
| `/uic-doctor` | Check setup |
| `/uic-discover` | Browser crawl |
| `/uic-contract-gen` | Generate contract |
| `/uic-contract-diff` | Detect drift |
| `/uic-contract-update` | Update contract |
| `/uic-test-gen` | Generate tests |
| `/uic-test-run` | Run tests |
| `/uic-optimize-loop` | Self-healing repair loop |
| `/uic-gate` | Coverage check |
| `/uic-report` | View report |

### Completion Gate Hook

UIC wires a Claude Code hook that runs the coverage gate at task completion:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "TaskComplete",
      "hooks": [{
        "type": "command",
        "command": "node ./tool/dist/cli.js gate"
      }]
    }]
  }
}
```

This prevents Claude from claiming UI work is done without browser verification.

## Project Config

`uic.config.ts`:

```typescript
export default {
  app: {
    name: 'My App',
    framework: 'react-vite',       // auto-detected
    baseUrl: 'http://localhost:5173',
    startCommand: 'npm run dev',   // UIC starts this automatically
    startTimeout: 30000,
  },
  auth: {
    strategy: 'ui-flow',           // drives login UI, caches session
    personas: {
      user: {
        email: '${TEST_USER_EMAIL}',
        password: '${TEST_USER_PASSWORD}',
      },
    },
  },
  discovery: {
    seedRoutes: ['/', '/login', '/dashboard', '/settings'],
    excludeRoutes: ['/reset-password'],
    screenshots: true,
  },
  exclusions: [
    { pattern: '/email/:id', reason: 'Dynamic route — needs fixture data' },
  ],
} satisfies UicConfig;
```

### Auth Strategies

| Strategy | How It Works | Best For |
|----------|-------------|----------|
| `ui-flow` | Drives login form, caches session | Most apps (recommended) |
| `api-bootstrap` | Calls login API, injects cookies | Apps with API-based auth |
| `storage-state` | Loads saved browser cookies | Pre-exported sessions |
| `custom` | Your own auth function | SSO, MFA, OAuth |

### Environment Variables

Credentials use `${ENV_VAR}` syntax and are loaded from `.env`:

```
TEST_USER_EMAIL=test@example.com
TEST_USER_PASSWORD=secret123
```

## Auto-Start

You never need to manually start your dev server. UIC reads `startCommand` from config, starts both frontend and backend, waits for the server to respond, runs the operation, and stops the server when done.

## Supported Frameworks

Auto-detected by `uic init`:

- React (Vite, CRA)
- Next.js
- Vue (Vite)
- Nuxt
- Svelte / SvelteKit
- Angular
- Any SPA or SSR app accessible via URL

## Artifacts

| File | What It Is |
|------|-----------|
| `.uic/inventory.json` | Every route and element discovered by the browser |
| `.uic/ledger.json` | Affordance accounting (discovered → accounted → 0 unaccounted) |
| `.uic/contract.json` | Coverage contract with surfaces, flows, invariants |
| `.uic/test-results.json` | Playwright test outcomes |
| `.uic/report.json` | Gate result with interaction coverage buckets |
| `.uic/repair-log.json` | Every repair applied with confidence and type |
| `.uic/generation-quality.json` | Multi-metric quality scores |
| `.uic/preconditions.json` | Synthesized test inputs and fixtures |
| `.uic/screenshots/` | Full-page screenshots per route |

## Recommended Workflow

### First time:
```
/uic
```

### After changing the UI:
```
/uic maintain
```

### Just check coverage:
```
/uic status
```

### If the gate fails:
```
/uic-report --format json
```
Then fix what's missing and re-run.

## Philosophy

- **Backend checks are not UI proof.** API passes, unit tests pass, source looks right — but the button doesn't work. UIC catches this.
- **Every element is accounted for.** 127 discovered → 108 deduplicated → 108 accounted → 0 unaccounted. No silent skips.
- **Real interactions, not visibility checks.** Click, fill, toggle, upload, navigate — not just "is it visible?"
- **Self-healing, not manual triage.** The optimize loop diagnoses and repairs most failures automatically.
- **Drift is surfaced, not ignored.** When the UI changes, the contract diff tells you exactly what's new, changed, or removed.

## Architecture

```
tool/
├── src/
│   ├── cli.ts                          # CLI entry (11 commands)
│   ├── config/
│   │   ├── types.ts                    # All TypeScript interfaces
│   │   ├── loader.ts                   # Config + .env loading
│   │   └── detector.ts                 # Framework auto-detection
│   ├── discovery/
│   │   ├── crawler.ts                  # Playwright browser crawl
│   │   └── element-classifier.ts       # DOM → element classification
│   ├── affordance/
│   │   ├── classifier.ts              # Element → affordance (action + oracle)
│   │   └── ledger.ts                  # Full accounting artifact
│   ├── contract/
│   │   ├── generator.ts               # Inventory → contract
│   │   └── differ.ts                  # Contract diff + update
│   ├── generation/
│   │   ├── primitive-generator.ts     # Affordance → Playwright test code
│   │   └── adapters.ts               # Widget-specific adapters
│   ├── gate/
│   │   └── checker.ts                 # Coverage gate (interaction buckets)
│   ├── repair/
│   │   ├── diagnoser.ts               # 4-layer failure classification
│   │   ├── precondition-synthesizer.ts # Auto-generate test inputs
│   │   └── quality-tracker.ts         # Multi-metric tracking
│   ├── auth/
│   │   └── persona.ts                 # 4 auth strategies
│   ├── utils/
│   │   └── server.ts                  # Auto-start/stop dev server
│   └── runner/
│       └── test-generator.ts          # Legacy v1 generator (kept for --legacy)
├── schemas/                            # JSON Schema definitions
├── docs/                               # Architecture, auth, gating docs
├── package.json
└── tsconfig.json
```

## Results on Example App (Cowork Assistant)

| Metric | v1 | v2 | v2.1 |
|--------|-----|-----|------|
| Tests generated | 28 | 132 | 132 |
| Tests with real interactions | ~10 | 114 | **132** |
| Empty TODO stubs | 18 | 0 | 0 |
| Pass rate | ~36% | 86.4% | **100%** |
| Affordances accounted | unknown | 108/108 | 108/108 |
| Unaccounted | unknown | 0 | 0 |

## License

MIT
