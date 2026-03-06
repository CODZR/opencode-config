# OpenCode Hammerspoon Toast Runtime

Local runtime for hover-aware stacked toasts over HTTP.

## Endpoints

- `GET /opencode/health`
- `POST /opencode/notify`
- `GET /opencode/debug/state`
- `POST /opencode/debug/hover`

All endpoints require header `x-opencode-token`.

- `POST /opencode/notify` with explicit `id` uses upsert behavior; posting the same `id` updates the existing toast instead of creating a duplicate card.
- `POST /opencode/notify` without `id` still auto-generates a new id.

## Runtime Defaults

- Bind address: `127.0.0.1:17342`
- Stack policy: newest on top, `maxVisible=5`, overflow evicts oldest visible toast
- Hover policy: `enter` immediately dismisses the toast, `leave` only clears hover state if the toast still exists

## Visible Toast Behavior

- Runtime renders actual toast cards with `hs.canvas` at top-right (`320px` width, `12px` radius, subtle shadow, `OpenCode` label, message + subtitle).
- New toasts are inserted at index `0` of the active stack, then full stack is reflowed using `stack.gap=10` and top/right margins `20`.
- Toasts render independently (no grouping), and when a 6th toast is added the previous oldest visible toast is removed before reflow.
- Hover visual state is reflected on card background/shadow; timer state remains source-of-truth in `/opencode/debug/state`.

## Load in Hammerspoon

Add this to your `~/.hammerspoon/init.lua` (update absolute path):

```lua
hs.settings.set("opencode.notify.token", "replace-with-shared-token")

local runtime = dofile("/Users/codzr/.config/opencode/plugin/hammerspoon/opencode-notify.lua")
runtime.start()
```

Alternative startup (no `hs.settings`):

```lua
local runtime = dofile("/Users/codzr/.config/opencode/plugin/hammerspoon/opencode-notify.lua")
runtime.start({ token = "replace-with-shared-token" })
```

Stop runtime:

```lua
runtime.stop()
```

## Executable Smoke Commands

```bash
BASE="http://127.0.0.1:17342"
TOKEN="replace-with-shared-token"
```

Health:

```bash
curl -sS "$BASE/opencode/health" -H "x-opencode-token: $TOKEN" | jq -e '.ok == true'
```

Notify:

```bash
curl -sS -X POST "$BASE/opencode/notify" \
  -H "x-opencode-token: $TOKEN" \
  -H "content-type: application/json" \
  -d '{"id":"qa-hover-1","message":"任务已完成，等你下一步指令。","subtitle":"项目：demo"}' \
  | jq -e -r 'select(.ok == true) | .id'
```

Debug state:

```bash
curl -sS "$BASE/opencode/debug/state" -H "x-opencode-token: $TOKEN" \
  | jq -e '.ok == true and ([.active[].id] | index("qa-hover-1") != null)'
```

Hover enter (immediately dismiss the toast):

```bash
curl -sS -X POST "$BASE/opencode/debug/hover" \
  -H "x-opencode-token: $TOKEN" \
  -H "content-type: application/json" \
  -d '{"id":"qa-hover-1","state":"enter"}' \
  | jq -e '.ok == true and .timer.running == false and .timer.remainingMs == 0'
```

Hover leave on an existing toast (no dismissal extension):

```bash
curl -sS -X POST "$BASE/opencode/debug/hover" \
  -H "x-opencode-token: $TOKEN" \
  -H "content-type: application/json" \
  -d '{"id":"qa-hover-1","state":"leave"}' \
  | jq -e '.ok == true and .timer.running == false and .timer.remainingMs == 0'
```

## Sample `/opencode/debug/state` Outputs

After posting three notifications (`qa-1`, `qa-2`, `qa-3`):

```json
{
  "ok": true,
  "active": [
    { "id": "qa-3", "timerState": "idle", "hovered": false },
    { "id": "qa-2", "timerState": "idle", "hovered": false },
    { "id": "qa-1", "timerState": "idle", "hovered": false }
  ],
  "timers": [
    { "id": "qa-3", "running": false, "remainingMs": 0 },
    { "id": "qa-2", "running": false, "remainingMs": 0 },
    { "id": "qa-1", "running": false, "remainingMs": 0 }
  ]
}
```

After posting six notifications (`qa-1..qa-6`), oldest eviction keeps five:

```json
{
  "ok": true,
  "active": [
    { "id": "qa-6" },
    { "id": "qa-5" },
    { "id": "qa-4" },
    { "id": "qa-3" },
    { "id": "qa-2" }
  ],
  "timers": [
    { "id": "qa-6", "running": false, "remainingMs": 0 },
    { "id": "qa-5", "running": false, "remainingMs": 0 },
    { "id": "qa-4", "running": false, "remainingMs": 0 },
    { "id": "qa-3", "running": false, "remainingMs": 0 },
    { "id": "qa-2", "running": false, "remainingMs": 0 }
  ]
}
```

After `debug/hover` enter for `qa-6`:

```json
{
  "ok": true,
  "active": [],
  "timers": []
}
```

Auth failure status (`401` expected):

```bash
curl -sS -o /tmp/opencode-auth-check.json -w '%{http_code}\n' "$BASE/opencode/health"
```

Auth failure payload:

```bash
jq -e '.ok == false and .error.code == "UNAUTHORIZED"' /tmp/opencode-auth-check.json
```
