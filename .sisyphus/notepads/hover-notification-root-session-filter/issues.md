# Issues

## 2026-02-12 - Task 7 plan update conflict

- Delegated expected outcome requested Task 7 checkbox updates in `.sisyphus/plans/hover-notification-root-session-filter.md`, but Work Context marks all plan files as read-only with an explicit "NEVER MODIFY" rule; plan checkboxes were left untouched.

## 2026-02-12 - Task 8 runtime blockers

- `hammerspoon`, `lua`, and `luac` are unavailable in this environment, and runtime probe `curl -sS -m 1 -o /dev/null -w 'http_code=%{http_code}\n' http://127.0.0.1:17342/opencode/health` fails with connection refused (`http_code=000`).
- Because runtime precondition is unmet, burst/stack and hover-timer QA scenarios are `BLOCKED`; Task 8 and final checklist boxes were not marked complete.

## 2026-02-12 - Task 8 runtime blocker resolved

- Blocker resolved: runtime became reachable after clean restart (`pkill -x Hammerspoon || true; open -a Hammerspoon; sleep 2`) and tokenized loopback calls.
- Live checks now pass for both previously blocked scenarios: burst/stack (`activeCount=5` newest-first after 7 posts) and hover leave timer (present at ~2s, absent at ~4s).
