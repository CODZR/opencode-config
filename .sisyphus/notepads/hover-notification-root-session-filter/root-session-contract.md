# Root-Session Idle Notification Contract

## Contract Goal
Define deterministic event handling so idle notifications fire only for root sessions (`Session.parentID` absent), with explicit idle confirmation and duplicate suppression.

## Canonical Event Sources (SDK)
- `session.created` -> `properties.info: Session`
- `session.updated` -> `properties.info: Session`
- `session.status` -> `properties.sessionID`, `properties.status.type` (`idle` | `busy` | `retry`)
- `session.idle` -> `properties.sessionID`
- Root/session hierarchy field -> `Session.parentID?: string`

## Canonical Ingestion Order
When multiple events are pending in the same processing turn, consume them in this stable order:
1. `session.created`
2. `session.updated`
3. `session.status`
4. `session.idle`

If two events share the same type, preserve arrival order.

## Session Classification Rule
- `isRoot = !session.parentID` (treat `undefined`, `null`, or empty string as absent)
- Notify **only** when `isRoot === true`
- If `isRoot === false` (child session), suppress all idle notifications for that session

## Runtime State (per `sessionID`)
- `isRoot: boolean | "unknown"`
- `notifiedSinceBusy: boolean` (dedupe latch)
- `pendingIdleTimer: NodeJS.Timeout | null`

## Idle Confirmation Policy
- Default idle confirmation delay: `800ms`
- Delay applies to both idle signals:
  - `session.status` with `status.type === "idle"`
  - `session.idle`
- Timer callback re-checks current state before notify:
  - `isRoot === true`
  - `notifiedSinceBusy === false`

## Dedupe Policy
- Dedupe condition: if an idle signal is received while `notifiedSinceBusy === true`, suppress notification.
- Reset dedupe latch only on a busy transition:
  - `session.status` with `status.type === "busy"` -> `notifiedSinceBusy = false`

## Child Session Suppression
- For `Session.parentID` present:
  - never schedule idle timer
  - never emit notification
  - cancel any existing `pendingIdleTimer` immediately on classification/update to child

## State Transition Table
| Incoming signal | Preconditions | Actions | Result |
| --- | --- | --- | --- |
| `session.created` / `session.updated` | `properties.info.id = S` | Update `isRoot` from `info.parentID`; if child, cancel timer | Session classification updated |
| `session.status` (`busy`) | Session `S` exists or is created lazily | Cancel timer; set `notifiedSinceBusy = false` | `S` becomes eligible for next idle notify |
| `session.status` (`idle`) | `isRoot === true` and `notifiedSinceBusy === false` | Start/refresh `pendingIdleTimer(800ms)` | Await idle confirmation |
| `session.idle` | `isRoot === true` and `notifiedSinceBusy === false` | Start/refresh `pendingIdleTimer(800ms)` | Await idle confirmation |
| `session.status` (`idle`) or `session.idle` | `notifiedSinceBusy === true` | No-op (dedupe suppress) | No notification |
| Idle timer fires | `isRoot === true` and `notifiedSinceBusy === false` | Emit one notification; set `notifiedSinceBusy = true`; clear timer | One idle notification emitted |
| Idle timer fires | `isRoot !== true` or `notifiedSinceBusy === true` | Clear timer, no notify | Suppressed |

## Implementation Notes (Binding)
- `session.created`/`session.updated` must populate classification before evaluating idle for the same processing turn.
- Unknown sessions (`isRoot === "unknown"`) are non-notifiable until metadata arrives.
- This contract intentionally allows at most one idle notification per busy->idle cycle per root session.
