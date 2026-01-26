# Example: Production Incident - Payment Service Outage

A complete 5-Whys analysis of a production payment service failure.

---

## 5-Whys Analysis: Payment Service Outage (2024-01-15)

### Problem Statement

| Field | Details |
|-------|---------|
| **What** | Payment API returning 503 errors, all transactions failing |
| **When** | 2024-01-15, 14:23 UTC, during peak traffic |
| **Where** | payment-service in production (us-east-1) |
| **Duration** | 47 minutes |
| **Impact** | ~$150,000 in failed transactions, 12,000 affected users |

### Timeline

```
14:23 - First 503 errors appear in monitoring
14:25 - Alert fires: payment-service error rate > 5%
14:28 - On-call engineer begins investigation
14:35 - Identified: all DB connections exhausted
14:42 - Attempted restart, problem persists
14:55 - Root cause identified: connection leak
15:02 - Hotfix deployed
15:10 - Service fully recovered
```

---

### Why Chain

| Level | Question | Answer | Evidence |
|-------|----------|--------|----------|
| **Why 1** | Why did the payment API return 503 errors? | Database connection pool was exhausted (0/100 available) | Connection pool metrics showed 100/100 in use |
| **Why 2** | Why was the connection pool exhausted? | Connections were being acquired but not released | Connection age histogram showed connections held for hours |
| **Why 3** | Why were connections not being released? | Exception thrown before connection.close() in refund handler | Stack trace in logs showed exception at line 142 |
| **Why 4** | Why did the exception prevent connection close? | No try-finally block; close() only in happy path | Code inspection of RefundHandler.java |
| **Why 5** | Why was there no try-finally block? | Code copied from old service that used auto-commit (no explicit close needed) | Git blame showed copy-paste from legacy service |

---

### Root Cause

**Identified Cause:** Connection handling code was copied from a legacy service that used auto-commit mode (where connections auto-close). The new service uses manual transactions, requiring explicit close(), but the code pattern wasn't updated.

**Category:** Design Gap (incorrect pattern application)

**Confidence:** High (reproduced in staging)

---

### Multi-Branch Analysis

The outage had a contributing factor that made it worse:

```
Primary Branch (Root Cause):
Connection leak in refund handler
    ↓
Pool exhausted

Contributing Branch (Made it worse):
Why wasn't this caught earlier?
    ↓
Why 1: No connection pool monitoring alert
    ↓
Why 2: Monitoring dashboard existed but no alert threshold
    ↓
Why 3: Alert was in backlog, not prioritized
    ↓
Why 4: No SLO defined for connection pool utilization
```

---

### Validation

Testing the causal chain backwards:

| If... | Then... | Validates? |
|-------|---------|------------|
| Try-finally added to RefundHandler | Connections always released | ✓ Tested in staging |
| Connections always released | Pool never exhausts | ✓ Load test confirmed |
| Pool never exhausts | No 503 errors from DB | ✓ Verified |
| No 503 errors | Payment service stays healthy | ✓ |

---

### Countermeasures

| Priority | Type | Action | Owner | Status |
|----------|------|--------|-------|--------|
| **P0** | Immediate | Add try-finally to RefundHandler | @dev-alice | ✅ Done |
| **P0** | Immediate | Audit all DB handlers for same pattern | @dev-bob | ✅ Done (found 2 more) |
| **P1** | Prevention | Add connection pool alert at 80% | @sre-carol | ✅ Done |
| **P1** | Prevention | Linter rule: require try-finally for DB connections | @dev-alice | 🔄 In progress |
| **P2** | Detection | Connection age histogram alert (>5min) | @sre-carol | 📋 Planned |
| **P2** | Process | Code review checklist: resource cleanup | @tech-lead | 📋 Planned |

---

### Lessons Learned

1. **Code copying is risky** - Patterns from one context may not apply in another
2. **Resource cleanup needs defense in depth** - Linting + review + monitoring
3. **Monitoring without alerts is incomplete** - Dashboards don't page on-call
4. **Connection pools need visibility** - Should be first-class metric

---

### Follow-up Verification

**30-day check:**
- [ ] No connection pool exhaustion incidents
- [ ] Linter rule catching violations in PRs
- [ ] Connection age alerts working (tested with chaos engineering)

---

## Analysis Quality Assessment

| Criteria | Met? | Notes |
|----------|------|-------|
| Problem specific and measurable | ✓ | Exact error, time, impact quantified |
| Each "why" has evidence | ✓ | Logs, metrics, code inspection |
| Root cause is actionable | ✓ | Code change fixes it |
| Root cause is preventable | ✓ | Linter + review prevents recurrence |
| Chain validates backwards | ✓ | Tested in staging |
| No blame, only process | ✓ | Focused on missing patterns/tools |
| Countermeasures assigned | ✓ | Owners and timelines set |
