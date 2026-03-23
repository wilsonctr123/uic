# Open-Source Readiness

## Current State

The tool/ directory is structured as a standalone npm package that can be
published to npm and hosted on GitHub as its own repository.

## To Extract to Own Repository

1. Copy `tool/` to a new repo root
2. Rename if desired (e.g., `uic` → `@your-org/uic`)
3. Update package.json metadata (repository, bugs, homepage)
4. Add CI workflow (`.github/workflows/ci.yml`)
5. Publish to npm: `npm publish`

## What Is Currently Coupled

| Item | Coupling Level | Action Needed |
|------|---------------|---------------|
| tool/src/ | None | Ready to extract |
| tool/schemas/ | None | Ready to extract |
| tool/templates/ | None | Ready to extract |
| tool/README.md | None | Ready to extract |
| tool/LICENSE | None | Ready to extract |
| uic.config.ts | Project-specific | Stays in consumer repo |
| .claude/hooks/ | Project-specific | Stays in consumer repo |
| skill/ | Separate deliverable | Can be its own repo or stays with tool |

## Publishing Steps

```bash
# From the tool/ directory:
npm login
npm publish --access public
```

## How Another Repo Would Adopt

```bash
# 1. Install
npm install -D uic @playwright/test

# 2. Init
npx uic init

# 3. Edit uic.config.ts for your app

# 4. Start your dev server, then:
npx uic discover
npx uic contract gen
npx uic test gen
npx uic test run
npx uic gate
```

## CI Integration

```yaml
# .github/workflows/ui-coverage.yml
name: UI Coverage Gate
on: [pull_request]
jobs:
  ui-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npx playwright install chromium
      - run: npm run dev &
      - run: npx uic discover
      - run: npx uic test run
      - run: npx uic gate
```
