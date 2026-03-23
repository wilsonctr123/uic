---
name: uic-update
version: 0.1.0
description: |
  Update UIC to the latest version from GitHub. Pulls latest code, rebuilds CLI,
  and reinstalls all 12 global skills.
  Use when asked to "update uic", "upgrade uic", or "get latest uic version".
allowed-tools:
  - Bash
  - Read
---

# /uic-update — Update UIC to Latest Version

```bash
UIC_BIN=$(bash ~/.claude/skills/uic/bin/find-uic.sh)
if [ -z "$UIC_BIN" ]; then
  echo "UIC not found. Install first: git clone https://github.com/wilsonctr123/uic.git ~/.uic-tool && ~/.uic-tool/install.sh"
  exit 1
fi

# Find the UIC installation directory
UIC_DIR=$(echo "$UIC_BIN" | sed 's|node ||' | xargs dirname | xargs dirname)
echo "UIC installed at: $UIC_DIR"
echo "Current version: $(cat $UIC_DIR/VERSION 2>/dev/null || echo 'unknown')"
```

Run the upgrade:
```bash
bash "$UIC_DIR/bin/uic-upgrade"
```

After upgrade, report:
- Previous version
- New version
- What changed (git log between versions)
