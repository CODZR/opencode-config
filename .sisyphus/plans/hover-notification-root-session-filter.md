# Hover-Aware Notifications with Root-Session Filtering

## TL;DR

> **Quick Summary**: Build a custom hover-aware toast channel (Hammerspoon) for completion notifications, and only notify when the **root/main session** becomes idle to eliminate false alerts from subagent completions.
>
> **Deliverables**:
> - Root-vs-child session filter in `plugin/notification.js`
> - Hammerspoon local bridge + minimal aesthetic stacked toasts
> - 3-second dismiss timer triggered on **mouse leave**
> - Deterministic fallback to system notification when custom runtime unavailable
> - Agent-executable QA scenarios with captured evidence
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 -> Task 4 -> Task 6 -> Task 8

---

## Context

### Original Request
User wants notification UX optimized for practical usage:
- `project?.name` can be missing; notification must stay robust
- Notification should be minimal but pleasing
- Hover interaction is required ("mouse related dismiss behavior")
- Subagent completion currently triggers false "done" notifications while main work is still running

### Interview Summary
**Key Discussions**:
- System notifications (`osascript`/Notification Center) cannot provide hover callbacks
- User accepts non-system UI channel if it gives the desired hover behavior
- Preferred runtime: Hammerspoon-based custom toast layer
- Preferred dismiss interaction: start 3-second timer after mouse leaves notification
- Burst handling: multiple notifications should stack
- Fallback required when custom runtime is unavailable
- Test strategy: no new automated unit/integration test files; rely on agent-executed QA scenarios

**Research Findings**:
- `session.idle` includes only `sessionID`, so idle event alone cannot distinguish main vs subagent
- `Session.parentID` in SDK enables root vs child classification
- `session.created`/`session.updated` expose full session info for metadata cache
- `session.list` supports `roots=true` as authoritative fallback source for root IDs

### Metis Review
**Identified Gaps (addressed)**:
- Gap: false notifications from child sessions
  - Resolution: root-only notify policy based on `Session.parentID`
- Gap: race conditions around idle transitions
  - Resolution: short idle-confirmation delay + status recheck
- Gap: runtime reliability and security for local bridge
  - Resolution: localhost bind + auth token + hard timeout + fallback path
- Gap: scope creep into full notification platform
  - Resolution: explicit guardrails and exclusions

---

## Work Objectives

### Core Objective
Deliver a non-intrusive, aesthetically pleasing completion notification experience that supports hover-driven dismiss behavior while preventing false positives from subagent completion events.

### Concrete Deliverables
- Updated `plugin/notification.js` with:
  - root-session metadata cache
  - child-session suppression
  - custom-runtime dispatch with deterministic fallback
- New Hammerspoon-side bridge/runtime module (local HTTP handler + toast manager)
- Stacked toast UI with hover state tracking and leave-triggered dismiss timer
- Debug/health endpoints strictly for agent QA validation

### Definition of Done
- [x] Subagent idle events do not emit user-facing completion notifications
- [x] Root/main session idle events emit notifications exactly once per completed cycle
- [x] Hover leave starts 3-second dismiss timer; hover enter pauses/cancels dismissal
- [x] Burst events stack without collapsing to a single card
- [x] If Hammerspoon runtime unavailable, system fallback still notifies successfully
- [x] All QA scenarios are agent-executable with concrete evidence artifacts

### Must Have
- Root-session filtering (`parentID` aware)
- Hover-leave dismiss behavior (3 seconds)
- Minimal aesthetic toast styling
- Runtime fallback path

### Must NOT Have (Guardrails)
- No human-only verification steps
- No unrelated refactors outside notification pathway
- No expansion into cross-platform desktop notification framework
- No removal of existing project-label fallback chain
- No noisy terminal output that pollutes chat/input UI

---

## Verification Strategy (MANDATORY)

> **UNIVERSAL RULE: ZERO HUMAN INTERVENTION**
>
> ALL tasks in this plan MUST be verifiable WITHOUT any human action.
> Any criterion requiring manual hover/click/visual check is invalid.

### Test Decision
- **Infrastructure exists**: PARTIAL (repo has test patterns, but no plugin-level CI/script standardization)
- **Automated tests**: None (by user choice)
- **Framework**: N/A for new tests

### Agent-Executed QA Scenarios (MANDATORY — ALL tasks)

**Verification Tool by Deliverable Type**

| Type | Tool | How Agent Verifies |
|------|------|-------------------|
| Plugin logic (JS) | Bash (`node --input-type=module -e ...`) | Simulate event stream, assert emitted shell commands |
| Hammerspoon bridge/API | Bash (`curl`) | Send payloads, inspect JSON state/health |
| Hover lifecycle | Bash (`curl` debug endpoints) | Simulate hover enter/leave, assert timer-driven removal |
| Fallback path | Bash | Disable/unreachable bridge, assert fallback command path |

**Scenario Format (applies to each task)**

```
Scenario: <name>
  Tool: Bash (node/curl)
  Preconditions: <explicit runtime state>
  Steps:
    1. <exact command>
    2. <exact command/assertion>
  Expected Result: <concrete output/state>
  Failure Indicators: <concrete mismatch>
  Evidence: .sisyphus/evidence/<file>
```

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately):
├── Task 1: Lock event/filter contract and constants
├── Task 2: Design bridge contract + health/debug endpoints
└── Task 3: Design visual spec (minimal but pleasing) + stack behavior

Wave 2 (After Wave 1):
├── Task 4: Implement root-session filter + idle confirmation in plugin
├── Task 5: Implement Hammerspoon toast runtime (stack + hover state)
└── Task 6: Implement plugin dispatch to bridge + fallback + timeout

Wave 3 (After Wave 2):
├── Task 7: Integrate telemetry/noise suppression and resilience handling
└── Task 8: Run full agent QA matrix and capture evidence

Critical Path: Task 1 -> Task 4 -> Task 6 -> Task 8
Parallel Speedup: ~35-45% faster than strictly sequential execution
```

### Dependency Matrix

| Task | Depends On | Blocks | Can Parallelize With |
|------|------------|--------|---------------------|
| 1 | None | 4, 6 | 2, 3 |
| 2 | None | 5, 6 | 1, 3 |
| 3 | None | 5 | 1, 2 |
| 4 | 1 | 6, 8 | 5 |
| 5 | 2, 3 | 8 | 4, 6 |
| 6 | 1, 2, 4 | 8 | 5 |
| 7 | 4, 6 | 8 | None |
| 8 | 4, 5, 6, 7 | None | None |

### Agent Dispatch Summary

| Wave | Tasks | Recommended Agents |
|------|-------|-------------------|
| 1 | 1, 2, 3 | `task(category="unspecified-high", load_skills=["frontend-ui-ux"], run_in_background=false)` |
| 2 | 4, 5, 6 | dispatch in parallel after Wave 1 completes |
| 3 | 7, 8 | final integration + QA evidence pass |

---

## TODOs

> Implementation + validation are bundled in each task.

- [x] 1. Lock Root-Session Notification Contract

  **What to do**:
  - Define canonical event handling contract for `session.created`, `session.updated`, `session.idle`, `session.status`.
  - Define root-session rule: notify only when `parentID` is absent.
  - Define idle confirmation delay (default: 800ms) and dedupe window policy.

  **Must NOT do**:
  - Do not infer main session from message text/agent label only.
  - Do not notify directly from `session.idle` without metadata join.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: event-model and race-condition design with medium complexity.
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: helps maintain clean, readable event-state architecture despite UI-adjacent scope.
  - **Skills Evaluated but Omitted**:
    - `playwright`: web-focused; not needed for local event contract.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: 4, 6
  - **Blocked By**: None

  **References**:
  - `plugin/notification.js:74` - current idle trigger point to replace with root-aware flow.
  - `plugin/notification.js:77` - current session/cooldown logic that needs root-session-aware adaptation.
  - `node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts:648` - `Session` includes `parentID`.
  - `node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts:679` - `session.created` payload includes `info: Session`.
  - `node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts:685` - `session.updated` payload includes `info: Session`.
  - `node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts:478` - `session.idle` shape (only `sessionID`).
  - `node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts:471` - `session.status` provides busy/idle/retry state.

  **Acceptance Criteria**:
  - [x] Contract document embedded in code comments/constants specifies root-only notification rule.
  - [x] Simulated child-session idle path yields zero notify commands.

  **Agent-Executed QA Scenarios**:

  ```bash
  Scenario: Child session idle is suppressed
    Tool: Bash (node)
    Preconditions: Updated plugin code available
    Steps:
      1. Run node harness that feeds events:
         - session.created(root: s-root, parentID absent)
         - session.created(child: s-child, parentID=s-root)
         - session.idle(s-child)
      2. Capture mocked shell command array length
      3. Assert length equals 0
    Expected Result: No notification emitted for child idle
    Evidence: .sisyphus/evidence/task-1-child-idle-suppressed.txt
  ```

  **Commit**: NO

- [x] 2. Define Local Bridge Contract and Safety Guardrails

  **What to do**:
  - Define localhost bridge API contract for Hammerspoon runtime.
  - Include auth header token, timeout budget, and response schema.
  - Define debug/health endpoints for machine-verifiable QA.

  **Must NOT do**:
  - Do not expose unauthenticated non-local endpoints.
  - Do not use indefinite network waits.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: protocol design and reliability constraints.
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: keeps interface minimal and cohesive with UX goals.
  - **Skills Evaluated but Omitted**:
    - `chrome-devtools`: browser-centric, not needed for localhost app bridge.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: 5, 6
  - **Blocked By**: None

  **References**:
  - `plugin/notification.js:50` - current send-path seam where bridge-first dispatch will slot in.
  - `plugin/notification.js:35` - existing terminal-notifier usage and timeout-style precedent.
  - `https://www.hammerspoon.org/docs/hs.notify.html` - notification APIs and callback capabilities.

  **Acceptance Criteria**:
  - [x] Contract includes exact endpoints:
    - `GET /opencode/health` -> `{"ok":true}`
    - `POST /opencode/notify` -> `{"ok":true,"id":"..."}`
    - `GET /opencode/debug/state` -> active stack + timers
    - `POST /opencode/debug/hover` -> simulated enter/leave for QA
  - [x] Timeout budget defined (default: 150ms) and fallback trigger condition documented.

  **Agent-Executed QA Scenarios**:

  ```bash
  Scenario: Health endpoint contract is machine-verifiable
    Tool: Bash (curl)
    Preconditions: Hammerspoon bridge running on 127.0.0.1:17342
    Steps:
      1. curl -sS http://127.0.0.1:17342/opencode/health
      2. Assert JSON has ok=true
    Expected Result: Deterministic health response
    Evidence: .sisyphus/evidence/task-2-health.json
  ```

  **Commit**: NO

- [x] 3. Define Minimal Aesthetic Toast Spec with Stack Rules

  **What to do**:
  - Specify typography, spacing, corner radius, shadow, opacity, and motion constraints.
  - Specify stack behavior and max visible count.
  - Specify hover behavior states: enter, leave, dismiss countdown.

  **Must NOT do**:
  - Do not introduce heavy animations or disruptive visuals.
  - Do not use unbounded stack growth.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UX micro-interaction and visual polish requirements.
  - **Skills**: [`frontend-ui-ux`, `aesthetic`]
    - `frontend-ui-ux`: layout, spacing, readability.
    - `aesthetic`: subtle, refined visual hierarchy and motion.
  - **Skills Evaluated but Omitted**:
    - `ui-styling`: web-component oriented; this is desktop-like Lua UI runtime.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: 5
  - **Blocked By**: None

  **References**:
  - `plugin/notification.js:87` - current text payload shape to preserve simplicity.
  - `https://support.apple.com/guide/mac-help/mh40583/mac` - temporary vs persistent notification behavior context.

  **Acceptance Criteria**:
  - [x] Visual spec defines exact tokens (font size, padding, radius, shadow blur, vertical gap).
  - [x] Stack policy set to `maxVisible=5` (default) with oldest-eviction policy.
  - [x] Hover leave delay defined as 3000ms; hover enter cancels pending dismiss timer.

  **Agent-Executed QA Scenarios**:

  ```bash
  Scenario: Stack cap and eviction policy are deterministic
    Tool: Bash (curl)
    Preconditions: Bridge + debug state endpoint available
    Steps:
      1. Send 7 rapid POST /opencode/notify events
      2. GET /opencode/debug/state
      3. Assert active notifications length is 5
      4. Assert oldest IDs were evicted first
    Expected Result: Stable stack under burst load
    Evidence: .sisyphus/evidence/task-3-stack-state.json
  ```

  **Commit**: NO

- [x] 4. Implement Root-Only Filter + Idle Confirmation in Plugin

  **What to do**:
  - Add in-memory `sessionMeta` map keyed by `sessionID` with `parentID` and latest status.
  - Update event handler to ingest `session.created/session.updated/session.status`.
  - On `session.idle`, suppress if child; confirm idle after delay before notify.

  **Must NOT do**:
  - Do not trigger notifications for child sessions.
  - Do not block event loop with long synchronous waits.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: state machine + race-safe event processing.
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: helps keep event-state code clean and maintainable.
  - **Skills Evaluated but Omitted**:
    - `aesthetic`: not central for event filtering logic.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential in Wave 2
  - **Blocks**: 6, 8
  - **Blocked By**: 1

  **References**:
  - `plugin/notification.js:64` - centralized event switch to extend with new event types.
  - `node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts:648` - root/child discriminator field (`parentID`).
  - `node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts:471` - status model for confirmation checks.

  **Acceptance Criteria**:
  - [x] Child idle event path yields no calls to bridge/system notifier.
  - [x] Root idle event after busy->idle transition emits exactly one notification.
  - [x] Repeated idle events without intervening busy state are deduped.

  **Agent-Executed QA Scenarios**:

  ```bash
  Scenario: Root idle emits once; child idle emits none
    Tool: Bash (node)
    Preconditions: Plugin updated with session metadata tracking
    Steps:
      1. Simulate root busy->idle flow and child idle flow in one harness run
      2. Capture emitted command intents
      3. Assert one emit for root idle, zero for child idle
    Expected Result: False positive eliminated
    Evidence: .sisyphus/evidence/task-4-root-child-filter.txt

  Scenario: Duplicate idle without busy transition is suppressed
    Tool: Bash (node)
    Preconditions: Same root session ID reused
    Steps:
      1. Emit root idle twice within 1s
      2. Assert only first produces notification
    Expected Result: No double-notify spam
    Evidence: .sisyphus/evidence/task-4-dedupe.txt
  ```

  **Commit**: YES (groups with 5, 6)
  - Message: `feat(notification): filter child-session idle and add hover-runtime dispatch`
  - Files: `plugin/notification.js`, runtime bridge files
  - Pre-commit: node smoke harness commands from Task 4

- [x] 5. Implement Hammerspoon Toast Runtime (Stack + Hover State)

  **What to do**:
  - Implement toast rendering and stack layout in Hammerspoon.
  - Track hover state per toast and countdown timers.
  - On leave, start 3000ms dismiss timer; on re-enter, cancel timer.

  **Must NOT do**:
  - Do not require manual interaction for timer state progression in QA mode.
  - Do not ship debug endpoints publicly.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: desktop UI interaction and aesthetics.
  - **Skills**: [`frontend-ui-ux`, `aesthetic`]
    - `frontend-ui-ux`: robust stack layout behavior.
    - `aesthetic`: subtle motion/visual quality for "赏心悦目" requirement.
  - **Skills Evaluated but Omitted**:
    - `chrome-devtools`: not relevant for Hammerspoon canvas runtime.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with 4 and 6 after prerequisites)
  - **Blocks**: 8
  - **Blocked By**: 2, 3

  **References**:
  - `https://www.hammerspoon.org/docs/hs.notify.html` - notification interaction capabilities baseline.
  - `https://www.hammerspoon.org/docs/` - runtime primitives for UI/timers/http server.

  **Acceptance Criteria**:
  - [x] Stack renders up to configured cap with consistent spacing.
  - [x] Hover enter cancels pending dismiss timer.
  - [x] Hover leave starts exactly 3000ms dismiss timer.
  - [x] Timer expiry removes toast and updates stack positions.

  **Agent-Executed QA Scenarios**:

  ```bash
  Scenario: Hover leave starts 3-second dismiss timer
    Tool: Bash (curl)
    Preconditions: Runtime exposes /opencode/debug/hover and /opencode/debug/state
    Steps:
      1. POST /opencode/notify for id="qa-hover-1"
      2. POST /opencode/debug/hover {"id":"qa-hover-1","state":"enter"}
      3. POST /opencode/debug/hover {"id":"qa-hover-1","state":"leave"}
      4. sleep 2; GET /opencode/debug/state -> assert qa-hover-1 exists
      5. sleep 2; GET /opencode/debug/state -> assert qa-hover-1 missing
    Expected Result: Dismiss occurs after leave + ~3s
    Evidence: .sisyphus/evidence/task-5-hover-timer.json
  ```

  **Commit**: YES (groups with 4, 6)

- [x] 6. Integrate Bridge Dispatch, Timeout, and System Fallback

  **What to do**:
  - In plugin send path, call bridge first with hard timeout (150ms default).
  - On timeout/error/unavailable runtime, fall back to current system notification path.
  - Ensure all shell invocations are quiet to avoid UI corruption.

  **Must NOT do**:
  - Do not silently drop notifications when both paths fail (must log explicit error).
  - Do not emit command stdout/stderr into interactive chat UI.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: resilience + fallback orchestration.
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: maintain minimal/noiseless user-facing behavior.
  - **Skills Evaluated but Omitted**:
    - `aesthetic`: not primary for integration plumbing.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: 7, 8
  - **Blocked By**: 1, 2, 4

  **References**:
  - `plugin/notification.js:27` - current notifier probing logic to adapt.
  - `plugin/notification.js:43` - current osascript fallback seam.
  - `plugin/notification.js:29` - existing `.quiet()` usage to preserve.

  **Acceptance Criteria**:
  - [x] Bridge available -> custom runtime path used.
  - [x] Bridge unavailable -> fallback path used within timeout budget.
  - [x] No shell output leaks into chat/input UI.

  **Agent-Executed QA Scenarios**:

  ```bash
  Scenario: Bridge down triggers fallback without user-visible breakage
    Tool: Bash (node)
    Preconditions: Bridge intentionally unreachable
    Steps:
      1. Trigger root idle event in harness
      2. Assert bridge call timeout/failure handled
      3. Assert fallback notifier command emitted
      4. Assert stderr/stdout capture is empty for normal path
    Expected Result: Reliable notification with no UI corruption
    Evidence: .sisyphus/evidence/task-6-fallback.txt
  ```

  **Commit**: YES (groups with 4, 5)

- [x] 7. Add Operational Logging and Noise Control

  **What to do**:
  - Add concise structured logs for path selection (`bridge`, `fallback`, `suppressed-child`, `deduped`).
  - Keep logs developer-useful but non-spammy.
  - Confirm command-output silence remains intact.

  **Must NOT do**:
  - Do not log secrets/token values.
  - Do not log on every no-op event if it floods output.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: scoped observability adjustments.
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: maintain clean and understandable user-facing output behavior.
  - **Skills Evaluated but Omitted**:
    - `playwright`: no browser workflow involved.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: 8
  - **Blocked By**: 4, 6

  **References**:
  - `plugin/notification.js:61` - current plugin load log style.
  - `plugin/notification.js:90` - current error logging pattern.

  **Acceptance Criteria**:
  - [x] Logs clearly explain suppression reason when child session idle arrives.
  - [x] Logs distinguish bridge success vs fallback path.
  - [x] No noisy command traces appear in interactive UI.

  **Agent-Executed QA Scenarios**:

  ```bash
  Scenario: Logs expose decision path without noise
    Tool: Bash (node)
    Preconditions: Harness captures console output
    Steps:
      1. Run mixed event stream (child idle, root idle, bridge fail)
      2. Assert output includes path markers: suppressed-child, bridge-fail, fallback-used
      3. Assert no raw command status lines leak
    Expected Result: Debuggable yet clean output
    Evidence: .sisyphus/evidence/task-7-logs.txt
  ```

  **Commit**: YES (can group with Task 8 if small)

- [x] 8. Run End-to-End QA Matrix and Package Evidence

  **What to do**:
  - Execute full scenario matrix covering root/child filtering, burst stack, hover leave timer, fallback, and noise-free output.
  - Capture all evidence artifacts under `.sisyphus/evidence/`.
  - Verify no acceptance criterion depends on manual action.

  **Must NOT do**:
  - Do not ship without negative-path validations.
  - Do not leave evidence filenames ambiguous.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: integration-grade validation across multiple runtime paths.
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: ensures UX outcomes are validated, not just logic.
  - **Skills Evaluated but Omitted**:
    - `chrome-devtools`: desktop toast flow is not browser DOM-based.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Final sequential
  - **Blocks**: None
  - **Blocked By**: 4, 5, 6, 7

  **References**:
  - `.sisyphus/plans/hover-notification-root-session-filter.md` - this plan’s acceptance matrix.
  - `plugin/notification.js:56` - plugin entrypoint and event flow.

  **Acceptance Criteria**:
  - [x] Happy path (root idle + bridge up) passes.
  - [x] Negative path (child idle) produces zero notifications.
  - [x] Burst path enforces stack policy and eviction.
  - [x] Fallback path passes when bridge unavailable.
  - [x] Evidence files exist for every scenario.

  **Agent-Executed QA Scenarios**:

  ```bash
  Scenario: Full matrix run
    Tool: Bash
    Preconditions: Updated plugin + runtime + debug endpoints ready
    Steps:
      1. Execute scripted matrix runner for all scenarios
      2. Parse each assertion output as pass/fail
      3. Verify evidence files exist:
         - task-4-root-child-filter.txt
         - task-5-hover-timer.json
         - task-6-fallback.txt
         - task-7-logs.txt
    Expected Result: 100% scenario pass rate
    Evidence: .sisyphus/evidence/task-8-matrix-summary.txt
  ```

  **Commit**: YES
  - Message: `chore(notification): validate hover toasts and root-session guardrails`
  - Files: evidence and final notification runtime files
  - Pre-commit: matrix runner command

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 4-6 | `feat(notification): add root-session filtering and hover runtime dispatch` | `plugin/notification.js`, runtime bridge files | root/child + fallback smoke harness |
| 7-8 | `chore(notification): harden logs and validate QA matrix` | logging tweaks + evidence refs | matrix summary assertions |

---

## Success Criteria

### Verification Commands
```bash
# 1) Root/child filter smoke
node --input-type=module -e '<harness for root-child idle assertions>'

# 2) Bridge health
curl -sS http://127.0.0.1:17342/opencode/health

# 3) Hover leave timer simulation
curl -sS -X POST http://127.0.0.1:17342/opencode/debug/hover -H 'content-type: application/json' -d '{"id":"qa-hover-1","state":"leave"}'

# 4) Fallback behavior
node --input-type=module -e '<harness with bridge unavailable to assert fallback>'
```

### Final Checklist
- [x] Main/root completion notifications are accurate
- [x] Subagent false notifications are eliminated
- [x] Hover-leave 3-second dismiss works via custom runtime
- [x] Stacked notifications behave predictably under bursts
- [x] Fallback remains reliable and quiet
- [x] Evidence artifacts captured for all scenarios
