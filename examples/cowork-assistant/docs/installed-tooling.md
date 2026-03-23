# Phase 2 — Installed Tooling

**Date**: 2026-03-23

## A. Existing Ecosystem Tooling Installed/Configured

| Tool | Version | Purpose | Source |
|------|---------|---------|--------|
| @playwright/test | 1.58.2 | Browser automation & test runner | npm (official) |
| Playwright Chromium | bundled | Headless browser for tests | Playwright CLI |

### Why Playwright

- Best-in-class browser automation for SPAs
- First-class TypeScript support (matches this React/TS codebase)
- Built-in test runner with parallel execution
- Auto-wait, role-based locators, network interception
- Screenshot/video capture on failure
- WebSocket support for chat streaming tests
- Active maintenance, large ecosystem

### Configuration Added

- `web/playwright.config.ts` — project configuration
- `web/tests/e2e/` — test directory
- `web/tests/e2e/fixtures/` — shared auth fixtures
- npm scripts: `test:e2e`, `test:e2e:headed`, `test:e2e:ui`

## B. Custom Tooling Implemented (Nothing Adequate Existed)

| Component | File(s) | Purpose |
|-----------|---------|---------|
| UI Discovery Script | `scripts/discover-ui.ts` | Crawls running app, inventories all interactive elements |
| UI Contract Schema | `.claude/ui-contract.yaml` | Machine-readable coverage requirements |
| Contract Checker Gate | `.claude/hooks/check-ui-contract.py` | Blocks completion when coverage missing |
| Contract Updater | `scripts/update-ui-contract.ts` | Diffs discovery vs contract, proposes updates |
| Coverage Reporter | (built into gate) | Produces `artifacts/ui-coverage-report.json` |

### Why Custom

No existing tool combines:
1. Live browser discovery → machine-readable inventory
2. YAML-based coverage contract with required/informational tiers
3. Deterministic pass/fail gate comparing contract vs test results
4. Claude Code hook integration for enforcement
5. Update-mode diffing that preserves intent while tracking drift

The Playwright ecosystem provides the browser substrate. The custom layer provides the **enforcement and maintenance** logic on top of it.
