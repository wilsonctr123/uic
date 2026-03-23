# UIC Update Workflow

When the app changes, UIC's contract and tests need updating.

## When to Update

- After adding a new page/route
- After adding/removing interactive controls
- After changing navigation structure
- After modifying auth flows
- After any UI-visible feature change

## Update Steps

```bash
# 1. Rediscover the current UI
/uic-discover

# 2. Check what changed
/uic-contract-diff

# 3. Apply changes (preserves manual policy edits)
/uic-contract-update

# 4. Regenerate tests for new/changed surfaces
/uic-test-gen

# 5. Run tests
/uic-test-run

# 6. Verify coverage
/uic-gate
```

## What Happens During Update

### Discovery (`/uic-discover`)
- Re-crawls all seed routes
- Overwrites `.uic/inventory.json` with current state
- Takes fresh screenshots

### Diff (`/uic-contract-diff`)
- Compares current contract against new inventory
- Reports: added surfaces, removed surfaces, changed surfaces, added/removed flows

### Update (`/uic-contract-update`)
- **Added** surfaces/flows are appended to the contract
- **Removed** surfaces/flows are marked `status: "removed"` (NOT deleted)
- **Changed** surfaces get updated element lists while preserving policy
- Manual edits to `policy.required`, `policy.severity`, etc. are preserved

### Test Regeneration (`/uic-test-gen`)
- Generates new test files for new surfaces
- Updates existing test files with new elements
- Preserves custom test code if in separate files

## Automated via Skill

Run the full update in one step:
```bash
bash skill/scripts/maintain.sh
```
