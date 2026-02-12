# Learnings

## 2026-02-12 - Task 5 runtime implementation

- `hs.httpserver` callback does not expose a direct peer socket address, so loopback enforcement was implemented with strict loopback bind (`127.0.0.1`) plus non-loopback rejection from request network headers (`host`, `forwarded`, `x-forwarded-for`, `x-real-ip`).
- Deterministic QA behavior is easiest when `active` and `timers` snapshots are emitted in toast stack order (newest first), with timer records normalized to `running=false`, `dueAtMs=0`, `remainingMs=0` when idle.
- Hover lifecycle stays deterministic by treating `leave` as a full timer restart every time and `enter` as an unconditional cancel, with no residual countdown carryover.
- Overflow handling should evict the last stack item before insert to preserve exact `maxVisible=5` behavior under burst loads.

- Implemented per-session runtime state in `plugin/notification.js` keyed by `sessionID`: `isRoot` (`true|false|"unknown"`), `notifiedSinceBusy`, and `pendingIdleTimer`.
- Added root classification ingestion from both `session.created` and `session.updated` using `isRoot = !parentID` (treats absent/empty as root); child sessions immediately clear any pending idle timer.
- Added event handling for `session.status` and `session.idle`: busy clears timer and resets dedupe latch; idle signals schedule an `800ms` confirmation timer for eligible root sessions.
- Notification dedupe now follows busy->idle cycle semantics: once notified, repeated idle is suppressed until the next `session.status` busy transition.

## 2026-02-12 - Task 5 rendering completion

- `hs.canvas` per-toast windows are simplest to keep deterministic by rebuilding each active toast on reflow; with `maxVisible=5`, redraw cost remains low and state/UI ordering stays exact.
- Reliable stack placement comes from recomputing all toast `y` offsets from top margin every state change instead of attempting incremental move math.
- Hover simulation endpoint and canvas mouse enter/exit can share the same `applyHoverState` path so timer semantics stay identical for QA and real interaction.
- Added strict platform guard at scheduler and sender paths using `isDarwin` captured at plugin initialization so non-darwin runtimes never schedule idle confirmation timers or attempt notification commands.

## 2026-02-12 - Task 6 bridge integration

- `plugin/notification.js` now sends idle notifications to `POST http://127.0.0.1:17342/opencode/notify` first, with hard `150ms` timeout via `AbortController` + timer.
- Bridge success requires all of: HTTP 2xx, valid JSON, `ok === true`, and non-empty `id`; otherwise it falls back to existing terminal-notifier/osascript path.
- Added `x-opencode-token` header support resolved from plugin config (`bridgeToken`/`notifyToken`/`token`) or `OPENCODE_NOTIFY_TOKEN` env without logging token values.

## 2026-02-12 - Task 7 operational logging

- Added a compact decision logger with stable prefix `[NotificationPlugin][decision]` and markers only for meaningful branches: `suppressed-child`, `deduped`, `bridge-success`, `bridge-fallback`, `bridge-error`.
- Marker logs include only non-secret context (`sessionID`, reason code) and avoid any token/header value emission.
- Logging points are attached to suppression/dedupe decisions and bridge outcomes so observability improves without per-event noise spam.

## 2026-02-12 - Task 7 verification pass

- Added explicit reason tagging for suppression/dedupe markers (`idle-event` vs `timer-confirm`) to keep mixed-flow traces deterministic without adding event spam.
- Mixed stream harness now proves all required markers emit (`suppressed-child`, `deduped`, `bridge-success`, `bridge-fallback`, `bridge-error`) and keeps warning/error output at zero.
- Evidence captured in `.sisyphus/evidence/task-7-logs.txt` confirms no token/header leakage and no raw notifier command traces in console logs.

## 2026-02-12 - Task 8 matrix orchestration

- Plugin-only matrix scenarios are deterministic with inline Node harnesses: root/child filter+dedupe, fallback path, and noise control all passed with explicit expected/actual payloads.
- Runtime-gated QA must be preflighted with a single health probe; when `127.0.0.1:17342` is unreachable, burst/stack and hover-timer checks should be marked `BLOCKED` without speculative curl follow-ups.
- Capability capture (`command -v hammerspoon lua luac node curl jq`) is enough to separate code regressions from environment blockers in final evidence packaging.

## 2026-02-12 - Task 7 plan progress update

- Marked Task 7 and its three logging/noise-control acceptance checkboxes complete in `.sisyphus/plans/hover-notification-root-session-filter.md` using existing Task 7 evidence (`.sisyphus/evidence/task-7-logs.txt`), while leaving Task 8 unchanged.

## 2026-02-12 - Task 8 JSON key encoding fix

- JSON contract stability in this runtime depends on manual string escaping for object keys/values in `encodeJsonValue`; relying on `hs.json.encode` for scalar strings can collapse keys to empty strings.

## 2026-02-12 - Task 8 live runtime matrix refresh

- Live runtime QA is deterministic when startup is normalized with `pkill -x Hammerspoon || true` followed by `open -a Hammerspoon` and a short `sleep 2` before curl checks.
- Using a shared header token fallback (`${OPENCODE_NOTIFY_TOKEN:-opencode-test-token}`) keeps local health/debug/notify/hover calls reproducible without hardcoding secrets in evidence.
- Burst verification is robust with a single jq predicate over `/opencode/debug/state`: exact `active` length `5` and exact ID order `qa-burst-7..qa-burst-3`.
- Hover timer verification is stable as a two-check gate: presence at ~2s after `leave`, absence at ~4s after `leave`.

- Synchronized plan checklist checkboxes in `.sisyphus/plans/hover-notification-root-session-filter.md` to match already-verified evidence artifacts.
