#!/usr/bin/env bash
# SessionStart hook — injects repo context at the start of every conversation.
# Keep this fast (<500ms). No network calls.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Branch and working tree state
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'detached')"
DIRTY="$(git status --short 2>/dev/null | wc -l | tr -d ' ')"

# Active execution plans
ACTIVE_DIR="$ROOT/docs/exec-plans/active"
PLANS=""
if [ -d "$ACTIVE_DIR" ]; then
  PLANS="$(find "$ACTIVE_DIR" -maxdepth 1 -name '*.md' -not -name 'README.md' -not -name '.*' -exec basename {} \; 2>/dev/null | sort)"
fi

# Tech debt active count
DEBT_FILE="$ROOT/docs/exec-plans/tech-debt-tracker.md"
DEBT_COUNT=0
if [ -f "$DEBT_FILE" ]; then
  # Count rows in the Active table (lines starting with |, excluding header/separator)
  DEBT_COUNT="$(awk '/^## Active/,/^## Closed/' "$DEBT_FILE" | grep -cE '^\| *[0-9]' || true)"
fi

# Output — Claude sees this as session context
echo "## Session context (auto-injected)"
echo "- **Branch:** $BRANCH"
echo "- **Uncommitted changes:** $DIRTY file(s)"

if [ -n "$PLANS" ]; then
  echo "- **Active exec plans:**"
  echo "$PLANS" | while read -r p; do echo "  - \`$p\`"; done
else
  echo "- **Active exec plans:** none"
fi

echo "- **Active tech debt items:** $DEBT_COUNT"
