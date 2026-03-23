# UIC — Browser-First Webapp Test Coverage

Automated test generation and enforcement for web applications. UIC crawls your webapp with a real browser, discovers every interactive control, generates Playwright tests that actually click/fill/toggle/upload, and self-heals until 100% pass rate.

Built for AI coding agents (Claude Code, Copilot, Codex) and developers who need proof that UI changes work — not just that backend checks pass.

## Commands

| Command | What It Does |
|---------|-------------|
| **`/uic`** | **Run the full pipeline in one shot** (auto-detects bootstrap vs maintain) |
| `/uic-init` | Detect framework, create `uic.config.ts` |
| `/uic-doctor` | Verify setup: config, Playwright, artifacts |
| `/uic-discover` | Crawl app with real browser, inventory all controls (auto-starts server) |
| `/uic-contract-gen` | Generate coverage contract + affordance ledger |
| `/uic-contract-diff` | Detect UI drift since last contract |
| `/uic-contract-update` | Apply drift to contract, preserve manual edits |
| `/uic-test-gen` | Generate real Playwright interaction tests |
| `/uic-test-run` | Execute tests (auto-starts server) |
| `/uic-optimize-loop` | Diagnose failures → repair → rerun until 100% |
| `/uic-gate` | Coverage check — exit 0 (pass) or 1 (fail) |
| `/uic-report` | Display coverage report |

**CLI equivalents** (without Claude Code):

```
uic init | discover | contract gen|diff|update | test gen|run | optimize | gate | report | doctor
```

## Install

### One-line install (recommended)

```bash
git clone https://github.com/wilsonctr123/uic.git ~/.uic-tool && ~/.uic-tool/install.sh
```

This installs:
- **12 global Claude Code skills** (`/uic`, `/uic-discover`, etc.) — available in every project, every session
- **UIC CLI** — built and ready at `~/.uic-tool/dist/cli.js`

### Then in your webapp project:

```bash
# Install Playwright (one time)
npm install -D @playwright/test
npx playwright install chromium

# Init UIC config
/uic-init

# Set test credentials
echo 'TEST_USER_EMAIL=test@example.com' >> .env
echo 'TEST_USER_PASSWORD=secret123' >> .env

# Run everything
/uic
```

### Manual install (without global skills)

If you prefer project-local instead of global:

```bash
# Clone into your project
git clone https://github.com/wilsonctr123/uic.git tool/
cd tool && npm install && npm run build && cd ..

# Copy slash commands (project-local only)
cp -r tool/claude-integration/commands/ .claude/commands/

# Run
node tool/dist/cli.js init
```

### Config

`/uic-init` auto-detects your framework and generates `uic.config.ts`:

```typescript
export default {
  app: {
    name: 'My App',
    baseUrl: 'http://localhost:3000',
    startCommand: 'npm run dev',       // UIC starts this for you
  },
  auth: {
    strategy: 'ui-flow',
    personas: {
      user: {
        email: '${TEST_USER_EMAIL}',   // loaded from .env
        password: '${TEST_USER_PASSWORD}',
      },
    },
  },
  discovery: {
    seedRoutes: ['/', '/login', '/dashboard', '/settings'],
  },
} satisfies UicConfig;
```

## Example Run Output

```
$ /uic

  App not running at http://localhost:5173
  Starting: npm run dev
  Waiting up to 30s for http://localhost:5173...
  ✓ Server ready at http://localhost:5173

🔐 Authenticating as "user"...
   ✓ Authenticated as user

🔍 UIC Discovery — http://localhost:5173

  Crawling /login...
  Crawling /...
  Crawling /chat...
  Crawling /search...
  Crawling /tasks...
  Crawling /import...
  Crawling /setup...
  Crawling /admin...

✅ Discovery complete → .uic/inventory.json
   Routes: 9
   Elements: 127
   Buttons: 61
   Inputs: 15
   Links: 44

📊 Affordance Ledger → .uic/ledger.json
   Raw discovered: 127
   Deduplicated:   108
   Accounted:      108
   Unaccounted:    0
   ─────────────────────────
   Executable:     96
   Blocked:        9
   Informational:  3

   ✅ All affordances accounted for.

🧪 Generated 132 tests
   Interaction tests: 96
   Smoke tests:       9
   Blocked tests:     9
   Auth invariants:   1

🔧 UIC Optimize — Self-healing test repair

── Iteration 1/3 ──

📋 18 failures diagnosed:
   ambiguous-locator: 3
   dynamic-label: 7
   expected-401: 2
   self-navigation: 2
   date-format: 1
   llm-timeout: 3

🔨 Repairs: 18 applied, 0 skipped
   ✓ [A/ambiguous-locator] — added .first()
   ✓ [A/dynamic-label] — contextual locator
   ✓ [C/expected-401] — filtered expected errors
   ...

🔄 Rerunning tests...

📊 Quality Metrics (Iteration 1)
   Pass rate:           100.0% (132/132)
   Interaction coverage: 100.0%
   Blocked:             9
   Weakened:            0
   Coverage removals:   0

✅ 100% pass rate achieved!

============================================================
UIC COVERAGE GATE
============================================================

✅ PASSED — 0 errors, 0 warnings

📊 Interaction: 96/96 required controls tested
   Smoke:       9/9 routes tested
   Blocked:     9 (with reasons)
   Affordances: 96 executable / 108 total
   Invariants:  4/4 tested
============================================================
```

## Supported Frameworks

Auto-detected by `uic init`:

- React (Vite, CRA) / Next.js
- Vue (Vite) / Nuxt
- Svelte / SvelteKit
- Angular
- Any SPA or SSR webapp accessible via URL

## Auth Strategies

| Strategy | How It Works | Best For |
|----------|-------------|----------|
| `ui-flow` | Drives login form, caches session | Most apps (recommended) |
| `api-bootstrap` | Calls login API, injects cookies | API-based auth |
| `storage-state` | Loads saved browser cookies | Pre-exported sessions |
| `custom` | Your own auth function | SSO, MFA, OAuth |

## How It Works

### 1. Discovery

UIC launches headless Chromium, authenticates, and crawls every seed route. Extracts all interactive elements: buttons, links, inputs, uploads, checkboxes, tables, dialogs, tabs, menus — with their roles, labels, selectors, and states.

### 2. Affordance Classification

Each element becomes an **affordance** with:
- **Action**: click, fill, toggle, upload, navigate, select
- **Oracle**: what should happen (URL changes, element appears, attribute changes, network fires)
- **Disposition**: executable, blocked (with reason), informational, or excluded

The ledger accounts for every element. Zero unaccounted enforced.

### 3. Test Generation

Each executable affordance gets a **real Playwright test** — not a visibility check, not a TODO stub:

```typescript
test('search:button:keyword: click keyword', async ({ page }) => {
  await page.goto('/search');
  await page.getByRole('button', { name: /keyword/i }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: /keyword/i }).click();
  // Assert: attribute-changes (filter chip activation)
  await page.waitForTimeout(300);
});
```

Widget adapters handle special cases (chips with inline styles, file uploads via `setInputFiles`, Enter-to-submit inputs, ISO date format).

### 4. Self-Healing Optimize Loop

Diagnoses failures into 4 layers:

| Layer | What | Auto-fix? |
|-------|------|-----------|
| **A** | Test defects (bad locator, wrong assertion) | Yes |
| **B** | Missing preconditions (fixture, seed data) | Yes |
| **C** | Expected runtime (401, self-nav, LLM timeout) | Yes |
| **D** | Real app bugs (JS exception, API 500) | With `--allow-app-fixes` |

Iterates up to 3 times or until 100%.

### 5. Coverage Gate

Binary: every blocking executable affordance must have a passing test. Fails if unaccounted affordances > 0, blocking obligations silently decreased, or coverage improved only by weakening tests.

## Artifacts

| File | What It Is |
|------|-----------|
| `.uic/inventory.json` | Every route and element discovered |
| `.uic/ledger.json` | Affordance accounting (0 unaccounted enforced) |
| `.uic/contract.json` | Coverage contract: surfaces, flows, invariants |
| `.uic/test-results.json` | Playwright test outcomes |
| `.uic/report.json` | Gate result with interaction coverage buckets |
| `.uic/repair-log.json` | Every repair with confidence and type |
| `.uic/generation-quality.json` | Multi-metric quality scores |
| `.uic/preconditions.json` | Synthesized test inputs |
| `.uic/screenshots/` | Full-page screenshots per route |

## Claude Code Completion Hook

Prevents Claude from claiming UI work is done without browser proof:

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

## Architecture

```
src/
├── cli.ts                          # 11 CLI commands
├── affordance/
│   ├── classifier.ts              # Element → affordance (action + oracle)
│   └── ledger.ts                  # Full accounting artifact
├── auth/persona.ts                 # 4 auth strategies
├── config/
│   ├── types.ts                    # TypeScript interfaces
│   ├── loader.ts                   # Config + .env loading
│   └── detector.ts                 # Framework auto-detection
├── contract/
│   ├── generator.ts               # Inventory → contract
│   └── differ.ts                  # Contract diff + update
├── discovery/
│   ├── crawler.ts                  # Playwright browser crawl
│   └── element-classifier.ts      # DOM element classification
├── gate/checker.ts                 # Coverage gate (interaction buckets)
├── generation/
│   ├── primitive-generator.ts     # Affordance → Playwright test code
│   └── adapters.ts               # Widget-specific adapters
├── repair/
│   ├── diagnoser.ts               # 4-layer failure classification
│   ├── precondition-synthesizer.ts # Auto-generate test inputs
│   └── quality-tracker.ts        # Multi-metric quality tracking
└── utils/server.ts                # Auto-start/stop dev server
```

## Results on Example App

| Metric | Before UIC | After UIC |
|--------|-----------|-----------|
| Tests | 0 | 132 |
| Real interaction tests | 0 | 132 |
| Pass rate | — | 100% |
| Elements accounted | — | 108/108 |
| Unaccounted | — | 0 |

## Philosophy

- Backend checks are not UI proof
- Every element is accounted for — zero silent skips
- Real interactions, not visibility checks
- Self-healing, not manual triage
- Drift is surfaced, not ignored

## License

MIT
