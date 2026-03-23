---
description: Crawl the webapp with a real browser and inventory all interactive UI elements
allowed-tools:
  - Bash
  - Read
argument-hint: "[--persona user|admin|guest] [--no-start]"
---

Run the UIC discover command to crawl the application and inventory its UI surface.

The tool will **auto-start the dev server** using `startCommand` from `uic.config.ts` if the app isn't already running, and stop it when done.

1. Resolve and run:
```bash
UIC="node $(git rev-parse --show-toplevel)/tool/dist/cli.js"
$UIC discover $ARGUMENTS
```

2. After success, report:
   - Number of routes discovered
   - Number of interactive elements found
   - Path to the generated inventory: `.uic/inventory.json`
   - Any console errors or failed requests detected
   - Any routes that couldn't be reached

3. If auth fails, suggest setting `TEST_USER_EMAIL` and `TEST_USER_PASSWORD` env vars.

4. If the command fails, report the exact error.
