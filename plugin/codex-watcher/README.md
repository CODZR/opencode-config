# Codex Completion Watcher (LaunchAgent)

Operator runbook for `plugin/codex-watcher/manage-launchagent.sh` and plist `plugin/codex-watcher/com.codzr.codex-completion-watcher.plist`.

## Paths and Label

```bash
WATCHER_DIR="/Users/codzr/.config/opencode/plugin/codex-watcher"
MANAGER="$WATCHER_DIR/manage-launchagent.sh"
TEMPLATE_PLIST="$WATCHER_DIR/com.codzr.codex-completion-watcher.plist"
INSTALLED_PLIST="$HOME/Library/LaunchAgents/com.codzr.codex-completion-watcher.plist"
LABEL="com.codzr.codex-completion-watcher"
SERVICE="gui/$(id -u)/$LABEL"
```

## Install / Start / Status / Stop / Uninstall

```bash
"$MANAGER" install
"$MANAGER" start
"$MANAGER" status
"$MANAGER" stop
"$MANAGER" uninstall
```

## Install Env Behavior (Automatic)

`install` preserves or sets usable env values in the installed plist:
- `EnvironmentVariables.OPENCODE_NOTIFY_TOKEN` priority: shell `OPENCODE_NOTIFY_TOKEN` -> existing installed plist token (if non-placeholder) -> template token.
- `EnvironmentVariables.PATH` priority: existing installed plist PATH when present; otherwise `$(dirname "$(command -v node)"):/usr/bin:/bin:/usr/sbin:/sbin` (or system fallback if `node` is unavailable). Node bin is prepended when available.
- `EnvironmentVariables.CODEX_WATCHER_DEBOUNCE_MS` controls trailing debounce for completion notifications. Default is `3000` (ms), and `0` disables debounce (every completion notifies immediately).

Notification enrichment behavior:
- Completion `message` prefers the last `event_msg.payload.type=user_message` text associated to the same `task_started.turn_id`; if unavailable, it falls back to `task_complete.last_agent_message` normalization.
- Completion `subtitle` appends cwd basename when stream context provides `turn_context.payload.cwd` or `session_meta.payload.cwd` (for example: `Codex 任务完成 · combination-flooding`).
- When a `task_complete` event arrives without same-batch cwd context, watcher performs a lightweight session-file-head lookup for `session_meta.payload.cwd` and caches it in checkpoint state to keep repository hints stable across cycles.

Optional post-install inspection:

```bash
plutil -p "$INSTALLED_PLIST"
```

## Launchctl State Check

```bash
launchctl print "$SERVICE"
```

Expected service state semantics:
- `state = running`: watcher process is active.
- `state = waiting`: service is loaded and waiting between restarts/events.

## Bridge Health and Runtime Proof

Health check (auth header is required):

```bash
BASE="http://127.0.0.1:17342"
curl -sS "$BASE/opencode/health" -H "x-opencode-token: $TOKEN"
```

Synthetic event append + debug-state verification:

```bash
TURN_ID="qa-codex-watcher-$(date +%s)"
SESSION_FILE="$(python3 - <<'PY'
import glob, os
files = sorted(glob.glob(os.path.expanduser('~/.codex/sessions/**/*.jsonl'), recursive=True), key=os.path.getmtime)
print(files[-1] if files else '')
PY
)"

printf '%s\n' "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\",\"turn_id\":\"$TURN_ID\",\"last_agent_message\":\"watcher smoke\"}}" >> "$SESSION_FILE"

curl -sS "$BASE/opencode/debug/state" -H "x-opencode-token: $TOKEN" \
  | jq -e --arg id "$TURN_ID" '.ok == true and ([.active[].id] | index($id) != null)'
```

## Troubleshooting

| Symptom | Check | Expected / Fix |
|---|---|---|
| `UNAUTHORIZED` from bridge endpoints or watcher delivery | `curl -sS -o /tmp/opencode-auth.json -w '%{http_code}\n' "$BASE/opencode/health" -H "x-opencode-token: $TOKEN"` | Expect `200`. If `401`, set correct shared token in both bridge and `EnvironmentVariables.OPENCODE_NOTIFY_TOKEN`, then restart watcher. |
| `ECONNREFUSED` when posting to bridge | `curl -sS "$BASE/opencode/health" -H "x-opencode-token: $TOKEN"` | Bridge is not listening. Start/restart bridge runtime, then rerun watcher `start` and confirm `launchctl print "$SERVICE"` shows `running` or `waiting`. |
| Missing or placeholder token in installed plist | `plutil -p "$INSTALLED_PLIST"` | If token is empty or `__REPLACE_WITH_LOCAL_OPENCODE_NOTIFY_TOKEN__`, patch `EnvironmentVariables.OPENCODE_NOTIFY_TOKEN` in installed plist and restart service. |

Manual env patch (troubleshooting only):

```bash
TOKEN="replace-with-real-shared-token"
NODE_BIN_DIR="$(dirname "$(command -v node)")"

plutil -replace EnvironmentVariables.OPENCODE_NOTIFY_TOKEN -string "$TOKEN" "$INSTALLED_PLIST"
plutil -replace EnvironmentVariables.PATH -string "$NODE_BIN_DIR:/usr/bin:/bin:/usr/sbin:/sbin" "$INSTALLED_PLIST"

"$MANAGER" stop || true
"$MANAGER" start
"$MANAGER" status
```

## Rollback Drill (Deterministic)

```bash
"$MANAGER" uninstall
launchctl print "$SERVICE"
```

Expected after uninstall:
- `"$MANAGER" uninstall` prints `Uninstalled com.codzr.codex-completion-watcher.`
- `launchctl print "$SERVICE"` returns not-found output, e.g.:
  - `Bad request.`
  - `Could not find service "com.codzr.codex-completion-watcher" in domain for user gui: <uid>`
