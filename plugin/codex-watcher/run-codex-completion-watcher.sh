#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
BUN_FALLBACK="${HOME}/.bun/bin/bun"

if command -v node >/dev/null 2>&1; then
  exec node "$SCRIPT_DIR/codex-completion-watcher.mjs" "$@"
fi

if command -v bun >/dev/null 2>&1; then
  exec bun "$SCRIPT_DIR/codex-completion-watcher.mjs" "$@"
fi

if [[ -x "${BUN_FALLBACK}" ]]; then
  exec "${BUN_FALLBACK}" "$SCRIPT_DIR/codex-completion-watcher.mjs" "$@"
fi

echo "Error: missing JavaScript runtime. Install node or bun." >&2
exit 1
