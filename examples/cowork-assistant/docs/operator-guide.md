# UIC Operator Guide — Cowork Assistant

## Quick Reference

| Action | Command |
|--------|---------|
| Check setup | `/uic-doctor` |
| Discover UI | `/uic-discover` |
| Generate contract | `/uic-contract-gen` |
| Check for drift | `/uic-contract-diff` |
| Update contract | `/uic-contract-update` |
| Generate tests | `/uic-test-gen` |
| Run tests | `/uic-test-run` |
| Check coverage | `/uic-gate` |
| View report | `/uic-report` |

## 1. Start the App

```bash
# Terminal 1: Backend
cowork-api

# Terminal 2: Frontend
cd web && npm run dev
```

The app must be running at `http://localhost:5173` before discovery.

## 2. Set Auth Credentials

```bash
export TEST_USER_EMAIL=your-test-user@example.com
export TEST_USER_PASSWORD=your-password
```

## 3. Run Discovery

```bash
/uic-discover
```

This crawls all seed routes with a real browser and writes `.uic/inventory.json`.

## 4. Review the Contract

```bash
/uic-contract-gen
```

Review `.uic/contract.json`. Each surface has:
- `policy.required` — whether it blocks completion
- `policy.severity` — `blocking`, `warning`, or `info`
- `expectations.required_elements` — elements that must be visible

## 5. Run Tests

```bash
/uic-test-gen    # Generate Playwright tests
/uic-test-run    # Execute them
```

## 6. Check Coverage

```bash
/uic-gate
```

Exit 0 = pass, exit 1 = fail. The output lists every missing/failing item.

## 7. When Features Change

```bash
/uic-discover           # Re-crawl
/uic-contract-diff      # See what changed
/uic-contract-update    # Apply changes to contract
/uic-test-gen           # Regenerate tests
/uic-test-run           # Run updated tests
/uic-gate               # Verify coverage
```

## 8. Handling Deleted/Unreachable UI

Removed routes are marked `status: "removed"` in the contract, not deleted.
This preserves history and prevents silent drift.

If a route becomes unreachable (auth issues, env problems):
1. Check the inventory notes for why
2. Fix the underlying issue, or
3. Mark the surface as `unreachable` in the contract

## 9. Auth/Session Bootstrap

UIC supports 4 auth strategies. This repo uses `api-bootstrap`:
- Calls `POST /api/v1/auth/login` with credentials
- Caches the session in `.uic/auth/user.json`
- Reuses cached sessions until they expire

If auth fails: check that the test user exists and credentials are correct.

## 10. Troubleshooting

**Flaky selectors**: UIC prefers role-based locators (`getByRole`) over CSS.
If selectors break, re-run `/uic-discover` to regenerate.

**Dynamic UI**: For content that requires specific data (email detail pages),
add the route to `exclusions` in `uic.config.ts` with a reason.

**File System Access API**: `showDirectoryPicker()` doesn't work in headless
Chromium. The Setup page's folder picker is excluded.

## 11. Using UIC on Future Repos

```bash
# 1. Install
npm install -g uic  # or copy tool/ directory

# 2. Init
cd my-new-project
uic init            # Auto-detects framework, creates config

# 3. Edit uic.config.ts with your seed routes, auth, exclusions

# 4. Bootstrap
/uic-discover && /uic-contract-gen && /uic-test-gen && /uic-gate
```
