---
description: Run the full UIC workflow — discover, contract, test, gate — in one shot
allowed-tools:
  - Bash
  - Read
argument-hint: "[bootstrap|maintain|status]"
---

Run the full UIC workflow end-to-end. Accepts a mode argument:

- **bootstrap** (default if no UIC artifacts exist): full first-time setup
- **maintain** (default if artifacts already exist): rediscover, update, retest
- **status**: just check current coverage without changing anything

## Bootstrap mode

Run these commands in sequence, stopping on any failure:

```bash
UIC="node $(git rev-parse --show-toplevel)/tool/dist/cli.js"
```

1. If no `uic.config.ts` exists, run `$UIC init` and report the detected stack.
2. Run `$UIC doctor` — if it fails, report what's missing and stop.
3. Run `$UIC discover --persona user` — report route/element counts.
4. Run `$UIC contract gen` — report surface/flow/invariant counts.
5. Run `$UIC test gen` — report test file count.
6. Run `$UIC test run` — report pass/fail counts.
7. Run `$UIC optimize --iterations 3` — report repairs applied, pass rate improvement.
8. Run `$UIC gate` — report final coverage result.

After each step, give a one-line status before moving to the next.

## Maintain mode

```bash
UIC="node $(git rev-parse --show-toplevel)/tool/dist/cli.js"
```

1. Run `$UIC discover --persona user` — report what changed.
2. Run `$UIC contract diff` — report drift summary.
3. Run `$UIC contract update` — report what was updated.
4. Run `$UIC test gen` — report regenerated test count.
5. Run `$UIC test run` — report pass/fail.
6. Run `$UIC optimize --iterations 3` — report repairs applied, pass rate improvement.
7. Run `$UIC gate` — report final result.

## Status mode

```bash
UIC="node $(git rev-parse --show-toplevel)/tool/dist/cli.js"
```

1. Run `$UIC doctor` — report setup status.
2. Run `$UIC gate` — report coverage result.
3. If gate fails, show the blocking errors.

## Auto-detect mode

If no argument is given:
- If `.uic/contract.json` does NOT exist → run **bootstrap**
- If `.uic/contract.json` exists → run **maintain**

## Rules

- Stop immediately on any command failure and report which step failed.
- The dev server is auto-started by discover and test run — do not start it manually.
- After the final gate result, give a concise summary: what was discovered, what's covered, what's missing.
