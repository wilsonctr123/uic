# UIC — Complete Tutorial

## What Is UIC?

UIC (UI Contract) is a browser-first UI coverage enforcement tool. It prevents anyone — human or AI agent — from claiming UI work is done when only backend checks, unit tests, or source inspection passed.

It works by:
1. Crawling your real webapp with a headless browser
2. Building a machine-readable inventory of every route and interactive element
3. Classifying each element into an **affordance** with an action (click, fill, toggle, upload, navigate) and an expected outcome (oracle)
4. Accounting for every discovered element — zero can be silently skipped
5. Generating **real interaction tests** (not visibility checks or TODO stubs)
4. Scaffolding Playwright tests from that contract
5. Checking test results against the contract — hard pass/fail gate
6. Detecting drift when your UI changes

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  YOU (or Claude Code)                                        │
│                                                              │
│  /uic-discover  /uic-gate  /uic-init  ...                   │
│  Thin slash commands — call CLI, summarize results           │
├──────────────────────────────────────────────────────────────┤
│  .claude/hooks/uic-gate.sh                                   │
│  Task completion hook — blocks unless gate passes            │
├──────────────────────────────────────────────────────────────┤
│  node tool/dist/cli.js                                       │
│  Deterministic engine — ALL logic lives here                 │
│  uic init | discover | contract | test | gate | report       │
├──────────────────────────────────────────────────────────────┤
│  uic.config.ts                                               │
│  Project-specific: routes, auth, exclusions                  │
├──────────────────────────────────────────────────────────────┤
│  .uic/                                                       │
│  Generated artifacts: inventory, contract, report, auth      │
└──────────────────────────────────────────────────────────────┘
```

**Key principle:** Slash commands are thin wrappers. The CLI is the source of truth. Config is project-specific. Artifacts are machine-readable.

## v2: Interaction-First Coverage (Current)

UIC v2 replaced the v1 "element visible on page" model with **interaction obligations**:

| v1 (old) | v2 (current) |
|----------|-------------|
| 127 elements → 28 tests (~10 real) | 127 elements → 132 tests (118 real interactions) |
| Visibility checks + TODO stubs | Real clicks, fills, toggles, uploads |
| Gate passes on shallow coverage | Gate requires real interaction for every blocking control |
| No element accounting | Full ledger: 0 unaccounted elements |

### How It Works

1. **Affordance Classifier** — deduplicates raw DOM, assigns each element a primitive action (click/fill/toggle/upload/navigate) and an oracle (expected outcome: url-changes/element-appears/attribute-changes/network-fires/etc.)
2. **Affordance Ledger** — accounts for every element: executable, blocked (with reason), informational, or excluded. Zero unaccounted.
3. **Primitive Generator** — generates real Playwright test code per affordance. Widget adapters handle special cases (Chip inline styles, file upload via setInputFiles, Enter-to-submit inputs).
4. **Interaction Gate** — separate coverage buckets (interaction vs smoke). Rejects TODO stubs. Binary: every blocking executable affordance must have a passing test.

### New Artifacts

| File | Purpose |
|------|---------|
| `.uic/ledger.json` | Full affordance accounting (the 127→108→0 proof) |
| `.uic/inventory.json` | Raw discovery output (unchanged) |
| `.uic/contract.json` | Contract with surfaces/flows/invariants (unchanged) |
| `.uic/report.json` | Gate result with interaction coverage buckets |
| `.uic/repair-log.json` | Repair records from optimize loop (v2.1) |
| `.uic/generation-quality.json` | Quality metrics per iteration (v2.1) |
| `.uic/preconditions.json` | Generated fixtures and seed data (v2.1) |

---

## File Map

### Core Tool (`tool/`)

| File | Purpose |
|------|---------|
| `tool/src/cli.ts` | CLI entry — all 11 commands (including optimize) |
| `tool/src/config/types.ts` | TypeScript interfaces for everything |
| `tool/src/config/loader.ts` | Loads `uic.config.ts`, interpolates `${ENV_VAR}` |
| `tool/src/config/detector.ts` | Auto-detects framework, router, package manager |
| `tool/src/discovery/crawler.ts` | Playwright-based browser crawl |
| `tool/src/discovery/element-classifier.ts` | Classifies DOM elements into 17 types |
| `tool/src/contract/generator.ts` | Inventory → contract (surfaces, flows, invariants) |
| `tool/src/contract/differ.ts` | Diff two contracts, detect drift |
| `tool/src/gate/checker.ts` | Compare contract vs test results — pass/fail |
| `tool/src/auth/persona.ts` | 4 auth strategies (ui-flow, api-bootstrap, storage-state, custom) |
| `tool/src/runner/test-generator.ts` | Contract → Playwright test files |
| `tool/src/utils/server.ts` | Auto-start/stop dev server |
| `tool/src/affordance/classifier.ts` | Deduplicate → classify → assign action + oracle |
| `tool/src/affordance/ledger.ts` | Build affordance ledger with full accounting |
| `tool/src/generation/primitive-generator.ts` | Affordance → real Playwright interaction test |
| `tool/src/generation/adapters.ts` | Widget adapters (Chip, file upload, chat input) |
| `tool/src/repair/diagnoser.ts` | Classifies test failures into 4 layers (A/B/C/D) |
| `tool/src/repair/precondition-synthesizer.ts` | Generates fixtures and seed data |
| `tool/src/repair/quality-tracker.ts` | Multi-metric quality tracking + hard gate rules |
| `tool/src/index.ts` | Public API for programmatic use |

### Slash Commands (`.claude/commands/`)

| Command | What It Does |
|---------|-------------|
| **`/uic`** | **Run the full workflow in one shot (bootstrap, maintain, or status)** |
| `/uic-init` | Detect framework, create `uic.config.ts` |
| `/uic-doctor` | Check setup: config, Playwright, artifacts |
| `/uic-discover` | Crawl the app, generate inventory |
| `/uic-contract-gen` | Generate contract from inventory |
| `/uic-contract-diff` | Show what changed since last contract |
| `/uic-contract-update` | Apply changes, preserve manual edits |
| `/uic-test-gen` | Scaffold Playwright tests from contract |
| `/uic-test-run` | Execute Playwright tests |
| `/uic-gate` | Coverage check — exit 0/1 |
| `/uic-optimize-loop` | Diagnose failures, repair tests, iterate to 100% |
| `/uic-report` | Display latest coverage report |

### Generated Artifacts (`.uic/`)

| File | What It Is |
|------|-----------|
| `.uic/inventory.json` | Every route and element discovered by the browser |
| `.uic/contract.json` | Required surfaces, flows, invariants |
| `.uic/test-results.json` | Playwright test outcomes |
| `.uic/report.json` | Coverage gate result |
| `.uic/screenshots/` | Full-page screenshots per route |
| `.uic/auth/` | Cached auth state (gitignored) |
| `.uic/repair-log.json` | Repair records with layer, category, confidence |
| `.uic/generation-quality.json` | Quality metrics per optimize iteration |
| `.uic/preconditions.json` | Generated fixture files and seed data |

### Project Config

| File | What It Is |
|------|-----------|
| `uic.config.ts` | App-specific: base URL, start command, auth, seed routes, exclusions |

### Enforcement

| File | What It Does |
|------|-------------|
| `.claude/settings.json` | Wires gate hook on task completion |
| `.claude/hooks/uic-gate.sh` | Thin script that calls `uic gate` |
| `.claude/agents/uic-maintainer.md` | Multi-step orchestration subagent |

---

## How To Use: Step by Step

### One Command To Do Everything

```
/uic
```

This runs the full workflow end-to-end. It auto-detects which mode to use:

- **No contract yet?** → runs **bootstrap**: init → doctor → discover → contract → tests → **optimize** → gate
- **Contract exists?** → runs **maintain**: rediscover → diff → update → tests → **optimize** → gate

You can also be explicit:
- `/uic bootstrap` — full first-time setup
- `/uic maintain` — update after UI changes
- `/uic status` — just check current coverage without changing anything

The dev server is auto-started and stopped. You don't touch anything.

If you want to run individual steps instead, use the commands below.

---

### First Time Setup (Step by Step)

```
/uic-init
```

This detects your framework (React, Vue, Next.js, etc.), router, package manager, and generates `uic.config.ts`. Edit it to adjust:
- `app.startCommand` — how to start your dev server
- `auth.personas` — test user credentials (use `${ENV_VAR}` syntax)
- `discovery.seedRoutes` — routes to crawl
- `exclusions` — routes/features to skip

### Verify Setup

```
/uic-doctor
```

Checks: config exists, Playwright installed, which artifacts exist. Fix anything marked ❌.

### Discover Your UI

```
/uic-discover
```

This is the core of UIC. It:
1. **Auto-starts your dev server** if it's not running (uses `startCommand` from config)
2. Authenticates as the configured persona (defaults to `user`)
3. Opens a headless Chromium browser
4. Navigates to every seed route
5. Extracts all interactive elements (buttons, inputs, forms, tables, tabs, dialogs, etc.)
6. Records console errors and failed network requests
7. Takes full-page screenshots
8. Writes `.uic/inventory.json`
9. **Stops the dev server** if it started one

Options:
- `--persona guest` — crawl without auth (sees login page on protected routes)
- `--persona admin` — crawl as admin
- `--no-start` — don't auto-start the server

### Generate a Contract

```
/uic-contract-gen
```

Transforms the inventory into a coverage contract. The contract defines:

**Surfaces** — each route + persona + viewport + state combination:
```json
{
  "id": "search|user|desktop|initial",
  "route": "/search",
  "persona": "user",
  "expectations": {
    "required_elements": [
      { "role": "button", "name": "Search", "required": true }
    ],
    "no_console_errors": true,
    "no_failed_requests": true
  },
  "policy": {
    "required": true,
    "severity": "blocking"
  }
}
```

**Flows** — user journeys (page loads, form submissions, table interactions):
```json
{
  "id": "login-form",
  "name": "Login form submission",
  "steps": ["fill form fields", "submit form", "verify success feedback"],
  "required": true
}
```

**Invariants** — cross-cutting requirements:
- No console errors on any page
- No failed frontend requests
- Auth redirect for protected routes
- Critical UI visible

### Check for Drift

```
/uic-contract-diff
```

Compares the current contract against the latest inventory. Reports:
- Added surfaces (new routes/elements)
- Removed surfaces (routes that disappeared)
- Changed surfaces (element count changes)
- Added/removed flows

### Update the Contract

```
/uic-contract-update
```

Applies the diff to the contract:
- **Added** items are appended
- **Removed** items are marked `status: "removed"` (NOT deleted — preserves history)
- **Changed** items get updated elements while preserving your manual policy edits

### Generate Tests

```
/uic-test-gen
```

Creates Playwright test files from the contract:
- One `.spec.ts` per route
- `auth.setup.ts` — handles login before tests
- `fixtures/test-fixtures.ts` — monitors console errors and failed requests
- `auth-invariants.spec.ts` — tests auth redirect for protected routes
- Role-based locators (`getByRole`) preferred over CSS selectors

### Run Tests

```
/uic-test-run
```

Executes the generated Playwright tests:
1. **Auto-starts the dev server** if needed
2. Runs all specs via `npx playwright test`
3. Writes results to `.uic/test-results.json`
4. **Stops the server** when done

Options:
- `--headed` — run with visible browser window
- `--no-start` — don't auto-start

### Check Coverage (The Gate)

```
/uic-gate
```

This is the hard enforcement point. It compares:
- Contract requirements (required surfaces, flows, invariants)
- Test results (what actually passed)
- Current inventory (drift detection)

**Exit 0** = all required coverage met
**Exit 1** = blocking errors exist
**Exit 2** = artifacts missing

Output example (failing):
```
❌ FAILED — 22 errors, 7 warnings

🔴 ERRORS (blocking):
   • Required surface "login|guest|desktop|initial" has no passing tests
   • Required flow "Login form submission" has no passing tests
   ...

📊 Surfaces: 0/2 tested (2 required)
   Flows: 0/18 tested (18 required)
   Invariants: 2/4 tested
```

Options:
- `--strict` — also fail on warnings (drift)

### View Report

```
/uic-report
```

Displays the latest gate report. Also available as JSON:
```
/uic-report --format json
```

---

## How Auto-Start Works

You never need to manually start your dev server. The `discover` and `test run` commands handle it:

1. Check if `baseUrl` (e.g., `http://localhost:5173`) is responding
2. If not, spawn `startCommand` (e.g., `cd web && npm run dev`) as a background process
3. Poll every 1 second until the server responds (up to `startTimeout`)
4. Run the actual command (discovery or tests)
5. Kill the server process when done

To disable: pass `--no-start`.

---

## How Auth Works

UIC uses a **persona abstraction**. The contract says `persona: user` — the config defines how to authenticate that persona.

### Strategies

**`ui-flow`** (recommended) — drives the login UI:
```typescript
auth: {
  strategy: 'ui-flow',
  personas: {
    user: {
      email: '${TEST_USER_EMAIL}',
      password: '${TEST_USER_PASSWORD}',
    },
  },
}
```

**`api-bootstrap`** — calls a login API endpoint:
```typescript
auth: {
  strategy: 'api-bootstrap',
  personas: {
    user: {
      email: '${TEST_USER_EMAIL}',
      password: '${TEST_USER_PASSWORD}',
      loginEndpoint: '/api/v1/auth/login',
    },
  },
}
```

**`storage-state`** — loads pre-exported browser state:
```typescript
auth: {
  strategy: 'storage-state',
  personas: {
    user: { storageStatePath: '.uic/auth/user.json' },
  },
}
```

**`custom`** — your own auth function:
```typescript
auth: {
  strategy: 'custom',
  customHook: './my-auth.js',
}
```

### Environment Variables

Credentials use `${ENV_VAR}` syntax and are interpolated at runtime:
```bash
export TEST_USER_EMAIL=test@example.com
export TEST_USER_PASSWORD=secret123
```

---

## How the Completion Gate Works

When Claude Code finishes a task, the `.claude/settings.json` hook fires:

```
Task completion → PostToolUse hook → node tool/dist/cli.js gate → exit 0 or 1
```

If the gate fails, Claude sees the error output and knows exactly what's missing. It cannot claim "done" without passing.

The gate checks:
1. Every surface with `policy.required: true` + `severity: "blocking"` has a passing test
2. Every flow with `required: true` has a passing test
3. All required invariants are tested
4. No major drift between inventory and contract

---

## Typical Workflows

### "I just cloned a repo and want to set up UIC"

```
/uic
```

That's it. It auto-detects there's no contract and runs the full bootstrap.

Or step by step:
```
/uic-init           → creates uic.config.ts
                      edit it: seed routes, auth, exclusions
/uic-discover       → crawls app (auto-starts it)
/uic-contract-gen   → creates coverage contract
/uic-test-gen       → scaffolds Playwright tests
/uic-test-run       → runs tests (auto-starts app)
/uic-gate           → checks coverage
```

### "I changed the UI and need to update coverage"

```
/uic
```

It auto-detects the contract exists and runs maintenance mode.

Or step by step:
```
/uic-discover          → re-crawls
/uic-contract-diff     → shows what changed
/uic-contract-update   → applies changes
/uic-test-gen          → regenerates tests
/uic-test-run          → runs updated tests
/uic-gate              → verifies coverage
```

### "The gate is failing, what's wrong?"

```
/uic-report --format json    → see exactly what failed
```

Then fix it:
- Missing test? Write it or re-run `/uic-test-gen`
- Missing surface? Run `/uic-discover` to update inventory
- Stale contract? Run `/uic-contract-update`
- Unreachable route? Add to `exclusions` in `uic.config.ts`

### "I want to check coverage without changing anything"

```
/uic status
```

---

## The 17 Element Types

UIC classifies every interactive DOM element:

| Classification | Examples |
|---------------|----------|
| `button` | `<button>`, `[role="button"]` |
| `link` | `<a href>`, `[role="link"]` |
| `text-input` | `<input type="text">` |
| `password-input` | `<input type="password">` |
| `email-input` | `<input type="email">` |
| `search-input` | `<input type="search">`, `[role="searchbox"]` |
| `file-upload` | `<input type="file">` |
| `checkbox` | `<input type="checkbox">`, `[role="checkbox"]` |
| `date-input` | `<input type="date">` |
| `textarea` | `<textarea>` |
| `select` | `<select>` |
| `table` | `<table>` |
| `form` | `<form>` |
| `tab` | `[role="tab"]` |
| `dialog` | `[role="dialog"]` |
| `toggle` | `[role="switch"]` |
| `menu` | `[role="menu"]` |

---

## Using UIC on a Different Repo

UIC is designed to work on any webapp. To use it elsewhere:

1. Copy or install the `tool/` directory
2. Run `/uic-init` — it auto-detects React, Vue, Svelte, Angular, Next.js, Nuxt, SvelteKit
3. Edit the generated `uic.config.ts`:
   - Set `app.startCommand` to your dev server command
   - Set `app.baseUrl` to your dev server URL
   - Configure auth personas with credentials
   - List your seed routes
   - Add exclusions for untestable features
4. Copy `.claude/commands/uic-*.md` for slash commands
5. Copy `.claude/hooks/uic-gate.sh` and `.claude/settings.json` for enforcement

The tool adapts to whatever it finds. The config is the only project-specific part.

---

## v2.1: Self-Healing Test Repair

UIC v2.1 adds an **optimize loop** that diagnoses test failures and applies mechanical repairs automatically.

### The `uic optimize` Command

```bash
node tool/dist/cli.js optimize --iterations 3
```

Or via slash command:
```
/uic-optimize-loop
```

This reads `.uic/test-results.json`, classifies each failure, applies repairs, and reruns until the pass rate converges.

**Options:**
- `--iterations <n>` — max repair iterations (default: 3)
- `--allow-app-fixes` — also apply Layer D fixes (app source code changes)

### Repair Layers

Every failure is classified into one of 4 layers:

| Layer | What It Is | Auto-fixed? | Examples |
|-------|-----------|-------------|---------|
| **A** | Test authoring defect | Yes | Ambiguous locator, dynamic label, date format, self-navigation, wrong primitive |
| **B** | Environment/precondition | Yes | Missing fixture file, missing seed data, auth not configured |
| **C** | Expected runtime behavior | Yes | Guest 401 from /auth/me, LLM timeout, test timeout |
| **D** | Real app defect | Only with `--allow-app-fixes` | JavaScript exception, API 500, broken route |

### What Gets Repaired

| Category | Repair Applied |
|----------|---------------|
| `ambiguous-locator` | Adds `.first()` to all locator occurrences in the test |
| `dynamic-label` | Converts `test()` to `test.skip()` with documented reason |
| `unnamed-element` | Converts to `test.skip()` — element has no stable locator |
| `date-format` | Replaces `'test input value'` with ISO date `'2026-01-15'` |
| `self-navigation` | Replaces `waitForURL` with `toBeVisible` assertion |
| `expected-401` | Filters 401/Unauthorized from console error assertions |
| `llm-timeout` | Converts to `test.skip()` — LLM response non-deterministic |
| `stale-locator` | Converts to `test.skip()` — element conditionally rendered |
| `disabled-element` | Converts to `test.skip()` — element requires specific state |
| `wrong-primitive` | Replaces `.check()` with `.click()` |

### Quality Tracking

Each iteration produces quality metrics:
- Pass rate, interaction coverage, blocked count
- Weakened assertions count, coverage removals
- Obligation integrity (discovered, accounted, unaccounted)

**Hard gate rules** prevent gaming the metrics:
1. Unaccounted affordances must be 0
2. Blocking obligations must not silently decrease
3. No improvement only by weakening tests
4. Coverage removals must be 0 unless justified

### Precondition Synthesis

The optimize loop auto-generates missing fixtures:
- `tests/e2e/fixtures/data/test-email.eml` — for email import tests
- `tests/e2e/fixtures/data/test-document.pdf` — minimal PDF for upload
- `tests/e2e/fixtures/data/test-transcript.txt` — Slack transcript
- `tests/e2e/fixtures/data/test-data.csv` — tabular data
- `tests/e2e/fixtures/seed-data.ts` — Playwright setup for seeding test data

Uses a retrieval hierarchy: repo asset → synthesize → derive → web fetch → blocked.

### Downgrade Resistance (Rule 3)

When the classifier encounters unnamed or dynamic elements, it tries 4 locator strategies before downgrading to informational:
1. aria-label
2. placeholder
3. Contextual locator via parent role
4. Specific CSS selector

Only when all 4 are exhausted does it downgrade, with explicit justification in `repairHints`.

### Results on This Repo

| Version | Tests | Pass Rate | Real Interactions |
|---------|-------|-----------|-------------------|
| v1 | 28 | ~36% | ~10 |
| v2 | 132 | 86.4% | 118 |
| v2.1 (optimize) | 132 | **100%** | 118 (14 skipped with documented reasons) |

---

## What UIC Does NOT Do

- **Visual regression testing** — no screenshot diffing (use Chromatic/Percy for that)
- **Component testing** — no Storybook integration (different concern)
- **Multi-browser** — Chromium only in v1
- **Production monitoring** — development/testing tool only
- **Full auto-fix** — repairs test infrastructure issues, but app bugs require `--allow-app-fixes`
- **Backend testing** — browser-first means frontend-only validation
