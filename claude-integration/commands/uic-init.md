---
description: Bootstrap UIC in this project — detect framework, create uic.config.ts, set up directories
allowed-tools:
  - Bash
  - Read
---

Run the UIC init command to scaffold browser-first UI testing in this project.

1. Resolve the UIC CLI:
```bash
UIC="node $(git rev-parse --show-toplevel)/tool/dist/cli.js"
$UIC init
```

2. If the CLI is not built, build it first:
```bash
cd $(git rev-parse --show-toplevel)/tool && npm run build
```

3. After success, report:
   - What framework was detected
   - Where `uic.config.ts` was created
   - What the user should edit before running `/uic-discover`

4. If the command fails, report the exact error and suggest fixes.
