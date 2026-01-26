# Example: Performance Regression - API Latency Increase

A 5-Whys analysis tracing a performance degradation to its root cause.

---

## 5-Whys Analysis: Search API Latency Regression

### Problem Statement

| Field | Details |
|-------|---------|
| **What** | Search API p99 latency increased from 200ms to 800ms |
| **When** | First observed 2024-02-01, after v2.3.0 deployment |
| **Where** | search-service, all regions |
| **Duration** | Ongoing until fix deployed |
| **Impact** | User complaints, 15% drop in search usage |

### Detection Timeline

```
Feb 1, 10:00 - v2.3.0 deployed to production
Feb 1, 14:00 - Latency alert fires (p99 > 500ms)
Feb 1, 14:30 - Investigation begins
Feb 2, 09:00 - Root cause identified
Feb 2, 15:00 - Fix deployed, latency returns to normal
```

---

### Why Chain

| Level | Question | Answer | Evidence |
|-------|----------|--------|----------|
| **Why 1** | Why did search API latency increase 4x? | Database queries taking longer | Query timing metrics showed DB time 600ms vs 100ms before |
| **Why 2** | Why are database queries slower? | Full table scan on products table | EXPLAIN ANALYZE showed Seq Scan instead of Index Scan |
| **Why 3** | Why is a full table scan happening? | Query predicate changed, doesn't use index | Query plan shows index on `category_id` not being used |
| **Why 4** | Why doesn't the new query use the index? | New filter uses `LOWER(category_name)` instead of `category_id` | Code diff in v2.3.0 shows the change |
| **Why 5** | Why was this change made without index? | Developer assumed existing index covered it; no query review | PR #1847 shows no query plan check |

---

### Deeper Investigation

**Why was there no query review in PR #1847?**

| Level | Question | Answer |
|-------|----------|--------|
| Why 5a | Why no query review? | Team doesn't have query review checklist |
| Why 5b | Why no checklist? | Performance wasn't seen as critical for search |
| Why 5c | Why wasn't it seen as critical? | No SLO defined for search latency |

**Second Root Cause:** No performance SLO → No review process → Regression shipped

---

### Root Causes

**Primary Root Cause:**
Query changed to use `LOWER(category_name)` for case-insensitive search, but no functional index exists for that expression.

**Category:** Design Gap + Process Gap

**Secondary Root Cause:**
No query performance review in PR process due to missing latency SLOs.

**Category:** Process Gap

---

### Validation

| Test | Result |
|------|--------|
| Add index on `LOWER(category_name)` | Query drops to 80ms ✓ |
| Deploy to staging with index | p99 returns to 180ms ✓ |
| Remove index, revert to `category_id` filter | Also fixes issue ✓ |

**Chosen Fix:** Add functional index (preserves case-insensitive feature)

```sql
CREATE INDEX idx_products_category_name_lower
ON products (LOWER(category_name));
```

---

### Why Wasn't This Caught Earlier?

| Stage | Should Have Caught? | Why It Didn't |
|-------|---------------------|---------------|
| **Code Review** | Maybe | Reviewer didn't check query plan |
| **Unit Tests** | No | Tests don't measure performance |
| **Integration Tests** | Maybe | Test data too small (100 rows vs 10M in prod) |
| **Staging** | Maybe | Staging has 1M rows, might have caught it |
| **Canary Deploy** | Yes | But canary wasn't enabled for this service |

---

### Countermeasures

| Priority | Type | Action | Owner | Status |
|----------|------|--------|-------|--------|
| **P0** | Immediate | Add functional index | @dba-team | ✅ Done |
| **P1** | Prevention | Query review checklist for PRs | @tech-lead | ✅ Done |
| **P1** | Prevention | Enable canary deployments | @sre-team | 🔄 In progress |
| **P2** | Detection | Query latency alert per endpoint | @sre-team | 📋 Planned |
| **P2** | Process | Define search latency SLO (p99 < 300ms) | @product | 📋 Planned |
| **P3** | Testing | Add performance test with prod-like data volume | @qa-team | 📋 Backlog |

---

### Query Review Checklist (Created)

For any PR that modifies database queries:

- [ ] Run `EXPLAIN ANALYZE` on new/modified queries
- [ ] Verify index usage (no Seq Scan on large tables)
- [ ] Check estimated rows vs actual rows
- [ ] Test with production-like data volume
- [ ] Document expected query performance

---

### Lessons Learned

1. **Case-insensitive search needs functional indexes**
   - `WHERE LOWER(col) = 'value'` won't use index on `col`
   - Must create index on `LOWER(col)`

2. **Test data volume matters**
   - 100 rows: any query is fast
   - 10M rows: missing index is catastrophic

3. **Canary deployments are essential**
   - Would have caught 4x latency increase with 1% traffic

4. **SLOs drive process**
   - Without latency SLO, no one prioritized performance review

---

### 30-Day Follow-up

- [ ] Search p99 consistently < 300ms
- [ ] Query review checklist being used in PRs
- [ ] Canary deployment enabled and tested
- [ ] Performance tests added to CI pipeline

---

## Analysis Quality Assessment

| Criteria | Met? | Notes |
|----------|------|-------|
| Problem specific | ✓ | Exact metric, timeframe, deployment |
| Evidence-based | ✓ | Query plans, metrics, code diffs |
| Multi-level causes | ✓ | Technical + process root causes |
| Actionable | ✓ | Index + checklist + canary |
| Preventable | ✓ | Process changes prevent recurrence |
| No blame | ✓ | Focus on missing process/tools |
