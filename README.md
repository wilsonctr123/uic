# UIC — AI QA Engineer for Any Webapp

**UIC doesn't click buttons and check "no crash." It reads your codebase, understands what your app does, and tests whether it actually works.**

Most test generators produce tests like this:
```typescript
// What other tools generate:
test('click Submit', async ({ page }) => {
  await page.click('#submit');
  await page.waitForTimeout(500); // hope nothing broke
});
```

UIC produces tests like this:
```typescript
// What UIC generates:
test('import Slack transcript creates searchable content', async ({ page }) => {
  // REASONING: The import page accepts Slack transcripts. After import,
  // the content should be searchable via the search page.
  await page.goto('/import');
  await page.getByPlaceholder(/Title/i).fill('Engineering Standup 2026-03-27');
  await page.getByPlaceholder(/Channel/i).fill('#engineering');
  await page.getByPlaceholder(/Paste a Slack/i).fill(
    'Alice: Deployed v2.1 to staging\nBob: LGTM, no rollbacks needed'
  );

  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/import/slack') && r.status() === 200),
    page.getByRole('button', { name: /Import Slack Transcript/i }).click(),
  ]);

  // Verify import succeeded — not just that the button was clickable
  await expect(page.locator('main')).toContainText(/success|queued|processing/i);
});
```

## Quick Start

```bash
# Install globally
npm install -g uic

# In your webapp project:
cd my-app
uic init          # Auto-detects React/Vue/Next/Svelte/Angular
uic               # Runs full pipeline: understand → discover → test → gate

# Or with Claude Code:
/uic              # Full AI-powered pipeline with visual analysis
/uic-followup     # Continue where /uic left off (no full re-run)
```

## What Makes UIC Different

### 1. It reads your codebase before testing

UIC reads your `README.md`, `CLAUDE.md`, route definitions, API endpoints, and database schema to understand what your app IS — not just what DOM elements it has.

```
📖 Phase 1: Reading codebase...
   Project: "email-orchestrator"
   Goal: "AI-powered executive assistant for email triage, document search, and task tracking"
   Features: 10 pages, 6 AI features
   Data: 90 emails, 50 tasks
   API keys: Anthropic CONFIGURED, OpenAI NOT SET
```

### 2. It looks at your app with screenshots

UIC takes screenshots of every page and visually analyzes them — finding multi-section layouts, upload zones, hidden features, and UI patterns that DOM crawling misses.

### 3. It generates tests that verify business logic

Not "button is visible" but "clicking the filter actually changes which tasks are shown." Not "input accepts text" but "searching for 'budget' returns emails about budget topics."

### 4. It finds real bugs

When a test fails because the AI chat returns a 401 auth error, UIC reports that as an **app bug** with severity, route, and fix instructions — not as a test failure to skip.

### 5. It produces an honest report

The report shows: what was tested, what wasn't, what bugs were found, what the user needs to fix, and an honest quality score that penalizes skipped critical tests.

### 6. It doesn't waste tokens

After the initial `/uic` run, use `/uic-followup` to check only the items you fixed — no full re-run needed. Pending action items persist in `.uic/TODO.md`.

## Commands

### CLI (works without Claude Code)

| Command | What It Does |
|---------|-------------|
| `uic` | **Run the full pipeline** |
| `uic init` | Detect framework, create `uic.config.ts` |
| `uic discover` | Crawl app, inventory all interactive elements |
| `uic contract gen` | Generate coverage contract |
| `uic contract diff` | Detect UI drift |
| `uic contract update` | Apply drift to contract |
| `uic test gen` | Generate Playwright tests (--no-overwrite default) |
| `uic test run` | Execute tests (auto-starts services) |
| `uic observe` | Live DOM observation for interaction groups |
| `uic optimize` | Self-healing test repair |
| `uic strengthen` | Add quality signals to tests |
| `uic gate` | Coverage check — exit 0 (pass) or 1 (fail) |
| `uic evidence` | Quality scoring report |
| `uic todo` | Show pending action items |
| `uic doctor` | Verify setup |

### Claude Code Skills (AI-powered)

| Skill | What It Does |
|-------|-------------|
| **`/uic`** | Full AI pipeline: visual analysis + code reading + intelligent testing + honest report |
| **`/uic-followup`** | Continue where `/uic` left off — check fixes, run targeted tests, update TODO |
| `/uic-init` | Detect framework, create config |
| `/uic-discover` | Browser crawl + element grouping |
| `/uic-test-gen` | Generate interaction tests |
| `/uic-test-run` | Execute tests |
| `/uic-gate` | Coverage check |
| `/uic-report` | Display coverage report |
| `/uic-optimize-loop` | Claude-powered deep repair |
| `/uic-doctor` | Verify setup |

## Install

### Option 1: npm (recommended)

```bash
npm install -g uic
```

### Option 2: From source

```bash
git clone https://github.com/wilsonctr123/uic.git ~/.uic-tool
cd ~/.uic-tool && npm install && npm run build
# Optional: install Claude Code skills
./install.sh
```

### In your project

```bash
npm install -D @playwright/test
npx playwright install chromium
uic init
uic
```

## Configuration

`uic init` auto-detects your stack. For full-stack apps, configure services:

```typescript
// uic.config.ts
export default {
  app: {
    name: 'My App',
    baseUrl: 'http://localhost:3000',
  },
  services: [
    { name: 'backend', command: 'python manage.py runserver', port: 8000, healthCheck: '/api/health' },
    { name: 'frontend', command: 'npm run dev', port: 3000, dependsOn: ['backend'] },
  ],
  auth: {
    strategy: 'api-bootstrap',   // or 'ui-flow', 'storage-state', 'custom'
    personas: {
      user: {
        email: '${TEST_USER_EMAIL}',
        password: '${TEST_USER_PASSWORD}',
        loginEndpoint: '/api/auth/login',
        signupEndpoint: '/api/auth/register',
      },
    },
  },
  discovery: {
    seedRoutes: ['/', '/dashboard', '/search', '/settings'],
    excludeRoutes: ['/admin'],
  },
  seeding: {
    apiCalls: [
      { method: 'POST', endpoint: '/api/tasks', body: { title: 'Test task' }, authenticated: true },
    ],
  },
} satisfies UicConfig;
```

## How It Works

### Phase 1: UNDERSTAND
Reads README, CLAUDE.md, route definitions, API endpoints, database schema. Optionally uses Claude API to reason about each feature's purpose.

### Phase 2: DISCOVER
Launches headless Chromium, authenticates, crawls every route. Groups related elements by container hierarchy and ARIA relationships. Classifies interaction patterns: chat, search, form, CRUD, filter, wizard, modal, pagination.

### Phase 3: OBSERVE
For each interaction group, actually interacts with the live app. Watches DOM mutations via `MutationObserver`. Records network requests. Measures settle time. Produces observation-grounded assertions.

### Phase 4: GENERATE
Three test types:
- **Primitive** — one test per element (click, fill, toggle)
- **Composite** — multi-step flows (fill form → submit → verify response)
- **Intelligent** — domain-aware tests from app understanding (realistic queries, validation checks)

### Phase 5: SELF-HEAL
Mechanical repair (10+ failure categories) + Claude-powered deep repair. Strengthener adds quality signals (waitForResponse, expect.poll, error pattern checks).

### Phase 6: GATE
Binary pass/fail. Every blocking affordance must have a passing test. Quality threshold enforced (default 9.5/10).

### Phase 7: REPORT
Standardized report with: executive summary, per-page feature matrix, per-test details, app bugs found, skipped test justifications, coverage gaps, and user action items.

## The Report

Every `/uic` run produces `.uic/REPORT.md` with:

- **Executive Summary** — pass/fail, quality score, test counts
- **Per-Page Coverage** — every feature found, whether it's tested, result
- **App Bugs Found** — real bugs with severity, route, expected vs actual, fix instructions
- **Skipped Tests** — classified as LEGITIMATE or FIXABLE
- **Coverage Gaps** — features found but not tested, with priority
- **User Action Items** — ranked list of things YOU need to fix

## Supported Frameworks

Auto-detected by `uic init`:
- React (Vite, CRA) / Next.js
- Vue (Vite) / Nuxt
- Svelte / SvelteKit
- Angular
- Any SPA or SSR webapp accessible via URL

Backend auto-detection: FastAPI, Django, Flask, Express, Rails, Go, and any service with a health endpoint.

## Auth Strategies

| Strategy | How | Best For |
|----------|-----|----------|
| `ui-flow` | Drives login form, caches session | Most apps |
| `api-bootstrap` | Calls login API, injects cookies, auto-signup | API auth |
| `storage-state` | Loads saved browser cookies | Pre-exported sessions |
| `custom` | Your own auth function | SSO, MFA, OAuth |

## Intelligence Layer (Optional)

Set `ANTHROPIC_API_KEY` to enable Claude-powered features:
- **App understanding** — Claude reads your codebase and reasons about each feature
- **Scenario generation** — Claude generates domain-aware test scenarios
- **Output evaluation** — Claude judges whether AI feature responses are relevant

Without an API key, UIC falls back to heuristic analysis (still works, less intelligent).

## Architecture

```
src/
├── cli.ts                    # 15 CLI commands
├── intelligence/             # v8: AI reasoning layer
│   ├── app-reader.ts         # Read codebase, understand project
│   ├── scenario-planner.ts   # Generate intelligent test scenarios
│   ├── output-evaluator.ts   # Judge AI output quality
│   ├── llm-client.ts         # Provider-agnostic LLM interface
│   └── llm-providers/        # Anthropic + OpenAI (raw fetch, no SDK)
├── discovery/                # Browser crawl + element classification
├── semantic/                 # Live DOM observation + pattern classification
├── generation/               # Test code generation (3 types)
├── affordance/               # Element → testable action mapping
├── contract/                 # Coverage contracts + drift detection
├── repair/                   # Self-healing (mechanical + strengthener)
├── gate/                     # Binary coverage gate
├── reporting/                # Quality scoring + evidence
├── pipeline/                 # Single-command orchestrator
└── utils/                    # Service startup, seeding, preflight
```

## Philosophy

- **Understand first, test second** — read the codebase before generating tests
- **Verify business logic, not DOM state** — "filter changes visible tasks" > "button is visible"
- **Honest scoring** — skipped critical tests lower the score, not hide it
- **App bugs are the goal** — a test that finds a real bug is the most valuable output
- **No wasted tokens** — `/uic-followup` continues where you left off
- **Zero hardcoded assumptions** — works on any webapp, any framework

## License

MIT
