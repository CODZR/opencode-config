# Local Bridge Contract: OpenCode -> Hammerspoon Runtime

## Scope

- Purpose: define the local HTTP contract used by `plugin/notification.js` to dispatch hover-aware notifications to Hammerspoon.
- Binding: `127.0.0.1:17342` only.
- Transport: HTTP/1.1 JSON (`Content-Type: application/json` for POST requests).
- Runtime primitives (Hammerspoon): `hs.httpserver` for endpoints and `hs.timer.doAfter()` + `timer:stop()` for dismiss scheduling/cancel.

## Security Guardrails (Mandatory)

- The server MUST bind only to `127.0.0.1` (or equivalent loopback interface) and MUST NOT listen on `0.0.0.0`.
- All endpoints require header `x-opencode-token: <token>`.
- Token source is local config/env only; token MUST NOT be logged.
- Token compare rule: exact byte-for-byte match after trimming surrounding whitespace from header value.
- Missing/invalid token returns `401` with the error schema below.
- Any request with non-loopback peer address MUST return `403` and MUST NOT be processed.

## Timeout Budget and Fallback

- Plugin request timeout budget for `POST /opencode/notify`: `150ms` total wall time.
- If the request does not complete successfully within `150ms`, plugin MUST trigger existing system notification fallback path.
- Fallback trigger criteria (any one is sufficient):
  1. connection refused/unreachable/error;
  2. timeout at or beyond `150ms`;
  3. non-2xx status code;
  4. response is not valid JSON;
  5. JSON has `ok !== true`;
  6. required success fields missing (for notify: missing non-empty `id`).

## Common Response Schemas

### Success Envelope

```json
{
  "ok": true,
  "...": "endpoint-specific fields"
}
```

### Error Envelope (all endpoints)

```json
{
  "ok": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "x-opencode-token is missing or invalid"
  }
}
```

Strict rules:
- `ok` MUST be boolean.
- On errors, `error.code` and `error.message` MUST both be present and non-empty strings.

## Endpoint Contract

### 1) `GET /opencode/health`

Purpose: liveness probe for runtime availability.

Request:
- Headers: `x-opencode-token` (required)
- Body: none

Success `200`:

```json
{
  "ok": true
}
```

Failure examples:

```json
{
  "ok": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "x-opencode-token is missing or invalid"
  }
}
```

```json
{
  "ok": false,
  "error": {
    "code": "FORBIDDEN_NON_LOCAL",
    "message": "loopback access only"
  }
}
```

### 2) `POST /opencode/notify`

Purpose: enqueue a toast card and return final toast id.

Request headers:
- `x-opencode-token` (required)
- `content-type: application/json` (required)

Request JSON schema (exact):

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["message", "subtitle"],
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "message": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500
    },
    "subtitle": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "sessionID": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "projectLabel": {
      "type": "string",
      "minLength": 1,
      "maxLength": 120
    },
    "createdAtMs": {
      "type": "integer",
      "minimum": 0
    }
  }
}
```

Semantics:
- `id` optional; runtime generates one if absent.
- `createdAtMs` optional; runtime sets current ms epoch if absent.

Success `200`:

```json
{
  "ok": true,
  "id": "toast_17342_0001"
}
```

Error examples:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_BODY",
    "message": "message and subtitle are required non-empty strings"
  }
}
```

```json
{
  "ok": false,
  "error": {
    "code": "UNSUPPORTED_MEDIA_TYPE",
    "message": "content-type must be application/json"
  }
}
```

### 3) `GET /opencode/debug/state`

Purpose: machine-verifiable runtime state for QA.

Request:
- Headers: `x-opencode-token` (required)
- Body: none

Success `200` schema (exact fields):

```json
{
  "ok": true,
  "nowMs": 1734200000000,
  "active": [
    {
      "id": "qa-hover-1",
      "message": "任务已完成，等你下一步指令。",
      "subtitle": "项目：demo",
      "hovered": false,
      "createdAtMs": 1734200000000,
      "dismissAfterMs": 3000,
      "timerState": "running"
    }
  ],
  "timers": [
    {
      "id": "qa-hover-1",
      "running": true,
      "dueAtMs": 1734200003000,
      "remainingMs": 2875
    }
  ]
}
```

Field constraints:
- `active` and `timers` MUST be arrays (empty allowed).
- `timerState` MUST be one of: `"idle"`, `"running"`.
- `remainingMs` MUST be `0` when `running=false`.

### 4) `POST /opencode/debug/hover`

Purpose: QA-only simulated hover events.

Request headers:
- `x-opencode-token` (required)
- `content-type: application/json` (required)

Request JSON schema (exact):

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["id", "state"],
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "state": {
      "type": "string",
      "enum": ["enter", "leave"]
    }
  }
}
```

State rules:
- `enter`: cancel pending dismiss timer for `id`, set `hovered=true`.
- `leave`: start/restart 3000ms dismiss timer for `id`, set `hovered=false`.

Success `200`:

```json
{
  "ok": true,
  "id": "qa-hover-1",
  "state": "leave",
  "timer": {
    "running": true,
    "dueAtMs": 1734200003000,
    "remainingMs": 3000
  }
}
```

Error example (unknown toast id):

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "toast id not found"
  }
}
```

## QA Commands (Copy/Paste)

```bash
BASE="http://127.0.0.1:17342"
TOKEN="replace-with-shared-token"
```

Health check (must print `true`):

```bash
curl -sS "$BASE/opencode/health" -H "x-opencode-token: $TOKEN" | jq -e '.ok == true'
```

Notify success (must print generated or provided toast id):

```bash
curl -sS -X POST "$BASE/opencode/notify" \
  -H "x-opencode-token: $TOKEN" \
  -H "content-type: application/json" \
  -d '{"id":"qa-hover-1","message":"任务已完成，等你下一步指令。","subtitle":"项目：demo"}' \
  | jq -e -r 'select(.ok == true) | .id'
```

State check after notify (must print `true`):

```bash
curl -sS "$BASE/opencode/debug/state" -H "x-opencode-token: $TOKEN" \
  | jq -e '.ok == true and ([.active[].id] | index("qa-hover-1") != null)'
```

Simulate hover leave (must print `true`):

```bash
curl -sS -X POST "$BASE/opencode/debug/hover" \
  -H "x-opencode-token: $TOKEN" \
  -H "content-type: application/json" \
  -d '{"id":"qa-hover-1","state":"leave"}' \
  | jq -e '.ok == true and .timer.running == true and .timer.remainingMs <= 3000'
```

Auth failure check (must print `401`):

```bash
curl -sS -o /tmp/opencode-auth-check.json -w '%{http_code}\n' "$BASE/opencode/health"
```

Auth failure payload check (must print `true`):

```bash
jq -e '.ok == false and .error.code == "UNAUTHORIZED"' /tmp/opencode-auth-check.json
```
