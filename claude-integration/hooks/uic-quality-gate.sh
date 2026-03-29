#!/bin/bash
# UIC Quality Enforcement Hook — blocks task completion if quality < 9.5
# Install in settings.json PostToolUse/TaskComplete
EVIDENCE=".uic/evidence-report.json"
THRESHOLD=9.5

[ ! -f "$EVIDENCE" ] && exit 0

QUALITY=$(node -e "try { const r = JSON.parse(require('fs').readFileSync('$EVIDENCE','utf-8')); console.log(r.summary?.averageQuality || 0); } catch { console.log(0); }" 2>/dev/null)
PASS=$(node -e "console.log(parseFloat('$QUALITY') >= $THRESHOLD ? 'yes' : 'no')" 2>/dev/null)

if [ "$PASS" = "no" ]; then
  echo ""
  echo "============================================"
  echo "UIC QUALITY GATE FAILED"
  echo "Average quality: $QUALITY / $THRESHOLD required"
  echo "============================================"
  echo ""
  echo "Continue the quality improvement loop."
  echo "Fix tests with quality < 7, then re-run."
  exit 1
fi

echo "UIC Quality Gate: PASSED ($QUALITY >= $THRESHOLD)"
exit 0
