# Decisions

## 2026-02-12 - Local bridge contract and guardrails

- Locked bridge bind target to `127.0.0.1:17342` and explicitly disallowed non-loopback exposure.
- Standardized auth on `x-opencode-token` for every endpoint, with strict `401` error envelope on mismatch/missing token.
- Set notify call timeout budget to `150ms` and defined deterministic fallback triggers: timeout/network error/non-2xx/invalid JSON/`ok !== true`/missing `id`.
- Fixed endpoint set to four routes only: `GET /opencode/health`, `POST /opencode/notify`, `GET /opencode/debug/state`, `POST /opencode/debug/hover`.
- Chose explicit JSON schemas with `additionalProperties: false` on POST bodies to avoid implementation ambiguity.
- Added copy-paste `curl` + `jq -e` QA commands with pass/fail-friendly outputs for machine verification.

- Locked notification eligibility to root sessions only: `Session.parentID` must be absent (`undefined`/`null`/empty) to notify.
- Locked canonical ingestion priority for mixed event bursts: `session.created` -> `session.updated` -> `session.status` -> `session.idle`.
- Locked idle confirmation debounce at `800ms` for both idle signal paths (`session.status: idle` and `session.idle`).
- Locked dedupe as a busy-cycle latch: suppress repeated idle notifications until a `session.status` busy transition resets eligibility.

## 2026-02-12 — Task 3: Minimal Aesthetic Toast Spec

- Chosen visual direction: dark, minimal, low-distraction cards with subtle depth (no flashy motion).
- Token baseline fixed to measurable defaults: `320px` width, `12px` radius, `10px` stack gap, `0.92` surface opacity.
- Stack policy fixed to deterministic cap: `maxVisible=5` with oldest-first eviction on overflow.
- Burst policy fixed: notifications remain independent cards (no grouping/collapse), newest-on-top ordering.
- Hover lifecycle fixed: `hover_enter` cancels dismiss timer; `hover_leave` starts a fresh `3000ms` timer.
- Timer semantics fixed: no residual countdown carryover after re-enter; each leave restarts full `3000ms`.
- Validation model fixed: QA state table with explicit preconditions/events/outcomes for machine-checkable behavior.
