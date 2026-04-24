#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET="$PROJECT_ROOT/node_modules/forge-workflow/scripts/beads-context.sh"
export PATH="$SCRIPT_DIR:$PATH"

if [[ ! -f "$TARGET" ]]; then
  echo "Error: forge-workflow beads-context helper not found at $TARGET" >&2
  exit 1
fi

exec bash "$TARGET" "$@"
