# UIC — Browser-First UI Coverage Enforcement Skill

## Description

This skill installs and maintains the UIC (UI Contract) tool for browser-first
UI coverage enforcement. It ensures that UI-affecting work is validated through
the real frontend, not just backend checks or source inspection.

## Modes

### Bootstrap Mode
Use when setting up UIC in a new repository for the first time.

```
/uic bootstrap
```

Steps:
1. Detect the project's framework, router, auth model, and dev server
2. Install Playwright if not present
3. Generate `uic.config.ts` with detected settings
4. Create `.uic/` directory
5. Run initial discovery against the running app
6. Generate the first coverage contract
7. Scaffold Playwright tests from the contract
8. Wire Claude Code hooks for enforcement
9. Report what was created and what needs manual review

### Maintain Mode
Use when the app has changed and the contract needs updating.

```
/uic maintain
```

Steps:
1. Re-run browser discovery
2. Diff new inventory against existing contract
3. Report additions, removals, and changes
4. Apply updates preserving manual policy edits
5. Regenerate tests for new surfaces
6. Run the coverage gate
7. Report current coverage status

### Report Mode
Use to check current coverage status without changes.

```
/uic report
```

Steps:
1. Run the coverage gate
2. Display human-readable report
3. List any failing contract items
4. Show drift warnings

## Implementation

This skill orchestrates the UIC CLI tool. It does NOT contain the core logic —
that lives in the `uic` npm package (tool/ directory).

### Bootstrap Implementation

```bash
# 1. Check if UIC tool is available
if [ -f "./tool/dist/cli.js" ]; then
  UIC="node ./tool/dist/cli.js"
elif command -v uic >/dev/null 2>&1; then
  UIC="uic"
else
  echo "Building UIC tool..."
  cd tool && npm install && npm run build && cd ..
  UIC="node ./tool/dist/cli.js"
fi

# 2. Initialize if no config exists
if [ ! -f "uic.config.ts" ]; then
  $UIC init
fi

# 3. Run discovery (requires running app)
$UIC discover --persona user

# 4. Generate contract
$UIC contract gen

# 5. Generate tests
$UIC test gen

# 6. Run gate
$UIC gate || echo "Gate failed — review contract and fix tests"
```

### Maintain Implementation

```bash
UIC="node ./tool/dist/cli.js"

# 1. Re-discover
$UIC discover --persona user

# 2. Diff
$UIC contract diff

# 3. Update
$UIC contract update

# 4. Regenerate tests
$UIC test gen

# 5. Run gate
$UIC gate
```

## Prerequisites

- Node.js >= 18
- A running webapp (dev server)
- Playwright (installed by bootstrap if missing)

## Auth Configuration

The skill reads auth config from `uic.config.ts`. For first-time setup,
set these environment variables:

```
TEST_USER_EMAIL=your-test-user@example.com
TEST_USER_PASSWORD=your-test-password
```

## Enforcement

After bootstrap, the `.claude/hooks/uic-gate.sh` script runs the coverage
gate at task completion. This means:

- Claude Code cannot claim UI work is done unless the gate passes
- The gate checks contract requirements against test results
- Missing coverage, untested surfaces, and drift all cause failures
- The failure output tells the agent exactly what is missing

## Philosophy

This skill enforces the principle:
**A UI-affecting feature is not done unless it works through the real frontend.**

Direct API calls, backend inspection, database checks, mocks, source inspection,
unit tests, or programmatic checks do NOT count as sufficient proof for UI work.
