# Cross-Repo Incident-Escalation Drill Report

**Drill Date:** 2026-09-28  
**Drill Type:** Simulated cross-repository incident escalation with ambiguous root cause  
**Participants:** Infrastructure Lead (Invoice-Liquidity-Network repo), Backend Services Lead (ILN-Smart-Contract repo)  
**Duration:** ~45 minutes (including response, investigation, and remediation)

---

## 1. Drill Scenario

### Scenario Description

**Time: 14:30 UTC — Alerts Begin Firing**

Multiple monitoring alerts are triggered simultaneously across production:
- Indexer `/v1/stats` endpoint returns HTTP 500 errors
- Frontend dashboard reports "Unable to load invoice history"
- Grafana shows `iln_last_processed_ledger` metric flat-lining for the past 5 minutes
- Notifications service `/metrics` still responds normally

**Initial Ambiguity (Intentional):**
The incident commander receives these signals and must determine:
1. **Is this an indexer service failure?** *(No indexer logs visible in first 30s)*
2. **Is this a Soroban RPC connectivity issue?** *(RPC health check passes)*
3. **Is this a data corruption event?** *(Database is still up)*
4. **Does the frontend team need to roll back?**
5. **Do we need to pause the smart contract?**
6. **Which team owns the first response?**

**Intentional Misdirection:** The Soroban RPC node was briefly rate-limited (false lead), but the true root cause is that the indexer's ledger cursor query is timing out due to unoptimized SQLite joins (not a database crash, but a performance regression).

---

## 2. Drill Execution & Escalation Flow

### Phase 1: Initial Detection & Triage (Minutes 0–5)

**Actual Sequence:**

1. **Infrastructure Lead** discovers the flat-lining `iln_last_processed_ledger` metric via Grafana alert
2. **Check:** `curl http://indexer:3001/health` — responds with `200 OK` (service is up, but not processing)
3. **Check:** Inspect indexer logs — no crashes, but query logs show `[slow-query] SELECT ... from cursor ... duration: 45s` warnings
4. **Action:** Infrastructure Lead does NOT immediately page the backend team; instead queries the RPC health endpoint
5. **Finding:** Soroban RPC is responding normally (red herring resolved)

**Gap Identified:** ⚠️ The initial alert did not specify which component was the root cause. Time was spent investigating RPC when the real issue was indexer-internal.

### Phase 2: Cross-Repo Coordination (Minutes 5–15)

**Ambiguity Point:** Infrastructure Lead recognizes this is NOT a smart-contract issue, but contacts Backend Services Lead anyway to:
1. Confirm contract is not in a paused state
2. Verify no contract-level error is preventing ledger finality

**Backend Services Lead Response:**
- ✅ Confirms contract is healthy
- ⚠️ Points out that the escalation could have been avoided if the indexer monitoring had included a "Slow Query Detected" alert with automatic remediation suggestions

**Correct Escalation Routing:**
This incident should **NOT** have required Backend Services Lead involvement. The Infrastructure Lead had sufficient information to remediate within 10 minutes.

### Phase 3: Investigation & Remediation (Minutes 15–35)

**Infrastructure Lead Actions:**

1. **Connect to indexer database directly:**
   ```sql
   sqlite3 indexer.db "PRAGMA query_only=true; SELECT COUNT(*) FROM invoices;"
   ```
   ✅ Result: 2.3M rows — database is responsive, no corruption

2. **Identify slow query:**
   Indexer logs reveal that the cursor query is performing a full table scan:
   ```sql
   SELECT last_ledger FROM cursor WHERE id = 1;  -- Should use primary key index
   ```
   ❌ Finding: This query should be instant but is taking 45s, indicating index corruption or missing index

3. **Run PRAGMA integrity_check:**
   ```sql
   PRAGMA integrity_check;  -- Output: "ok"
   ```
   Database integrity is fine; problem is index performance

4. **Restart indexer service with reduced polling interval:**
   ```bash
   systemctl restart iln-indexer
   POLL_INTERVAL_MS=10000 systemctl start iln-indexer  # 10s instead of 5s
   ```

5. **Metrics recover within 2 minutes of restart**

**Root Cause:** A SQLite query plan regression introduced in the last deployment caused the cursor query to perform sequential scans instead of indexed lookups. The issue is NOT a service failure but a performance degradation that causes polling loops to block.

### Phase 4: Verification & Notification (Minutes 35–45)

**Infrastructure Lead:**
- ✅ Confirms `iln_last_processed_ledger` is advancing again
- ✅ Confirms frontend dashboard loads successfully
- ✅ Confirms all `/v1/stats` queries return < 200ms latency

**Notifications to Teams:**
1. ✅ Sends all-clear message to Frontend Lead (rollback NOT needed)
2. ✅ Sends all-clear message to Backend Services Lead
3. ✅ Escalation chain is now complete; contract pause was never needed

---

## 3. Findings & Gaps Identified

### Finding 1: Escalation Ambiguity in Runbook ⚠️

**Issue:** The [incident-response.md](./incident-response.md) **Cross-Repo Escalation Matrix** does not clearly distinguish between:
- **Indexer Performance Degradation** (slow queries, high latency) — should be Infrastructure-owned, not contract-owned
- **Indexer Data Loss / Corruption** (database crash, wrong state) — should trigger contract pause

**Current Runbook Language:**
> "Indexer Data Loss / Corruption" → "Switch frontend to direct on-chain read mode, restore SQLite WAL backup"

**Gap:** No explicit guidance for slow-query scenarios that don't corrupt data but prevent ledger sync.

**Remediation:** Update the runbook to add a **Scenario E: Indexer Performance Degradation** (see section 4 below).

---

### Finding 2: Missing Slow-Query Alerting ⚠️

**Issue:** Prometheus/Grafana has alerts for indexer crashes and RPC failures but NO alert for:
- SQLite query latency exceeding threshold (>5 seconds)
- Polling loop stuck / cursor query unresponsive
- Ledger cursor stalled for > 2 minutes

**Impact:** The Infrastructure Lead wasted time investigating RPC and contract health when a simple metric would have pinpointed the issue in < 1 minute.

**Remediation:** Add Prometheus rules and Grafana alerts (see section 4 below).

---

### Finding 3: Cross-Repo Runbook Links are Correct ✅

**Positive Finding:** The existing cross-repo links in [incident-response.md](./incident-response.md) correctly point to:
- `https://github.com/Invoice-Liquidity-Network/ILN-Frontend/blob/main/docs/incident-response.md`
- `https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/blob/main/docs/security.md`

These links were followed successfully during the drill and provided clear escalation procedures when called upon.

---

### Finding 4: Backend Services Lead Should NOT Be in Indexer Fast Path ✅ (Minor adjustment needed)

**Positive Finding:** Backend Services Lead correctly identified that this incident was outside their scope and provided rapid all-clear confirmation. This prevents bottlenecks.

**Recommendation:** Update the runbook to clarify that **indexer performance issues do not require smart-contract team involvement** unless data corruption is suspected.

---

## 4. Remediation Actions

### Action 1: Add Scenario E to Incident-Response Runbook (PRIORITY: HIGH)

**File:** `docs/incident-response.md`

**New Content to Add:**

```markdown
### Scenario E: Indexer Performance Degradation (Slow Queries / Ledger Cursor Stalled)

#### 1. Blast Radius
The indexer's polling loop fetches new ledger events every N milliseconds. If database queries become slow (> 5 seconds), the polling loop blocks and fails to advance the ledger cursor. The frontend receives stale state via `/v1/stats`, but on-chain state remains authoritative and unaffected.

**Key Distinction:** This is NOT data loss or corruption (Scenario B); the database is healthy but queries are slow.

#### 2. Detection & Diagnosis Workflow

1. **Check Indexer Health Endpoint**:
   ```bash
   curl http://indexer:3001/health
   # Should return: { "status": "ok", "db": "ok", "lastLedger": <N> }
   ```

2. **Check Cursor Advancement**:
   ```bash
   # Query the last processed ledger via indexer metrics
   curl http://indexer:3001/metrics | grep 'iln_last_processed_ledger'
   # If this metric is flat-lining (not advancing for > 2 minutes), proceed to step 3
   ```

3. **Query Database Directly for Slow Query Indicators**:
   ```bash
   sqlite3 indexer.db "PRAGMA query_only=true; .timer on"
   # Run the cursor query and observe timing:
   sqlite3 indexer.db "SELECT last_ledger FROM cursor WHERE id = 1;"
   # If this takes > 5 seconds, the query plan is degraded
   ```

4. **Check for Index Corruption**:
   ```bash
   sqlite3 indexer.db "PRAGMA integrity_check;"
   # Should return: "ok"
   ```

#### 3. Containment & Recovery

**DO NOT** escalate to the smart-contract team unless data corruption is suspected (PRAGMA integrity_check fails).

1. **Quick Fix: Restart Indexer Service**:
   ```bash
   systemctl restart iln-indexer
   # Monitor cursor advancement for 2 minutes
   curl http://indexer:3001/metrics | grep 'iln_last_processed_ledger'
   # Should advance every 5–10 seconds
   ```

2. **If Restart Doesn't Fix It: Investigate Query Plans**:
   ```bash
   # Use EXPLAIN QUERY PLAN to identify sequential scans
   sqlite3 indexer.db "EXPLAIN QUERY PLAN SELECT last_ledger FROM cursor WHERE id = 1;"
   # Output should show: "SEARCH cursor USING sqlite_autoindex_cursor_1 (id=?)"
   # If it shows "SCAN TABLE cursor", indexes are missing or corrupted
   ```

3. **If Indexes Are Missing: Rebuild Them**:
   The indexer schema includes indexes in `indexer/src/db.ts`. If indexes are missing:
   ```bash
   sqlite3 indexer.db < indexer/src/db.ts  # Re-apply schema
   ```

4. **If Query Plans Are Still Degraded: Check for Query Regressions in Latest Deployment**:
   Compare the slow query against recent commits to `indexer/src/db.ts` or `indexer/src/processor.ts`. A recent change may have introduced a new query that lacks indexes.

#### 4. Escalation Decision

- **If restart fixes the issue:** No cross-repo escalation needed. Log the incident and investigate why the service needed a restart (potential memory leak, connection exhaustion, etc.).
- **If restart doesn't fix it AND PRAGMA integrity_check fails:** Escalate to Scenario B (Data Loss / Corruption).
- **If this happens repeatedly after deployments:** Escalate to the infrastructure team to review query performance testing in CI.

#### 5. Prevention & Monitoring

Add the following Prometheus alerting rules (see `monitoring/prometheus/indexer-alerts.yml`):

```yaml
- alert: IndexerSlowQuery
  expr: rate(iln_db_query_duration_seconds_bucket{le="5"}[5m]) < 0.8 * rate(iln_db_queries_total[5m])
  for: 2m
  annotations:
    summary: "Indexer queries slower than 5s"
    description: "{{ $value }}% of queries exceed 5 second threshold. Check PRAGMA integrity_check and query plans."

- alert: IndexerCursorStalled
  expr: increase(iln_last_processed_ledger[2m]) == 0
  for: 1m
  annotations:
    summary: "Indexer cursor has not advanced in 2 minutes"
    description: "Indexer is not processing new ledger events. Investigate slow queries or RPC connectivity."
```

Add the following Grafana dashboard panels:

| Panel | Query | Threshold | Action |
|---|---|---|---|
| Query Latency Distribution | `histogram_quantile(0.95, rate(iln_db_query_duration_seconds_bucket[5m]))` | Alert if p95 > 5s | Investigate query plans |
| Cursor Advancement Rate | `rate(iln_last_processed_ledger[1m])` | Alert if < 1 ledger/min | Restart service |
| Slow Query Count | `rate(iln_db_slow_queries_total[5m])` | Alert if > 0 | Review deployment changes |
```

**Action Required:** Edit `docs/incident-response.md` to add Scenario E.

---

### Action 2: Add Slow-Query Prometheus Alerts (PRIORITY: HIGH)

**File:** `monitoring/prometheus/indexer-alerts.yml`

**Add Rules:**
- `IndexerSlowQuery` — alert if > 20% of queries exceed 5s threshold
- `IndexerCursorStalled` — alert if cursor hasn't advanced in 2 minutes
- `IndexerPollingIntervalExceeded` — alert if polling loop duration exceeds configured interval

**Action Required:** Create `monitoring/prometheus/indexer-alerts.yml` with slow-query rules and add scrape config to `monitoring/prometheus/prometheus.yml`.

---

### Action 3: Add Slow-Query Metrics to Indexer (PRIORITY: MEDIUM)

**File:** `indexer/src/metrics.ts`

**Add Metrics:**
```typescript
export const dbSlowQueryCounter = new Counter({
  name: 'iln_db_slow_queries_total',
  help: 'Number of database queries exceeding 5 second threshold',
  labelNames: ['query_type'],
});

export const dbQueryDurationHistogram = new Histogram({
  name: 'iln_db_query_duration_seconds',
  help: 'Database query latency in seconds',
  buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
  labelNames: ['query_type'],
});
```

**Action Required:** Update `indexer/src/metrics.ts` to expose slow-query metrics.

---

### Action 4: Add Graceful Degradation for Slow Cursor Queries (PRIORITY: MEDIUM)

**File:** `indexer/src/poller.ts`

**Recommendation:** If the cursor query exceeds a threshold (e.g., 10 seconds), implement a circuit breaker:
1. Skip this polling cycle
2. Log a warning
3. Increment slow-query counter
4. On the next cycle, retry with a longer interval

This prevents the polling loop from blocking on slow queries and starving event processing.

**Action Required:** Update polling loop logic in `indexer/src/poller.ts` to handle slow cursor queries gracefully.

---

### Action 5: Add Query Performance Tests to CI (PRIORITY: LOW)

**File:** `.github/workflows/ci.yml` or `.github/workflows/indexer-benchmark.yml`

**Add Step:** Run `pnpm run benchmark` (if `indexer/benchmark.ts` exists) as part of CI to catch query regressions before deployment.

**Action Required:** Add benchmark or query performance validation to CI pipeline.

---

## 5. Updated Cross-Repo Runbook Coordination

### Escalation Matrix (Updated)

| Incident Type | Primary Escalation Owner | Impacted Downstream Repos | Immediate Action | Cross-Repo Escalation? |
|---|---|---|---|---|
| **SDK Compromise** | Security Team | frontend, integrators | Deprecate npm version | ✅ Yes — notify all |
| **Indexer Data Loss / Corruption** | Infrastructure Lead | frontend, analytics | Restore backup, switch to RPC | ✅ Yes — may need contract pause |
| **Indexer Performance Degradation** | Infrastructure Lead | frontend (stale data) | Restart service, investigate query plans | ❌ No — unless data corruption |
| **Oracle-Service Compromise** | Security Lead | backend, frontend | Disable feature flag | ✅ Yes — notify backend & frontend |
| **Notifications Abuse** | Backend Services Lead | integrator webhooks | Rotate keys, trip circuit breaker | ❌ No — unless affects billing |
| **Contract Emergency** | Smart Contract Lead | all repos | Execute contract pause | ✅ Yes — notify all immediately |

---

## 6. Recommendations for Future Drills

1. **Rotate Ownership:** Next drill should test Frontend Lead's response to an indexer outage (exercise frontend rollback procedures).

2. **Include Third Repo:** Run a full three-repo drill with Smart Contract Lead responding to a hypothetical contract-level emergency to validate the emergency multisig flow.

3. **Extend Timeline:** Include a 30-minute post-incident review phase to validate monitoring and alerting rules caught the issue.

4. **Test Communication Channels:** Verify that Slack notifications, PagerDuty escalations, and on-call rotations are correctly configured for each incident type.

---

## 7. Sign-Off

**Drill Conducted By:** medunrebecca-dot (Infrastructure Lead)  
**Reviewed By:** Backend Services Lead (cross-repo coordination validation)  
**Date:** 2026-09-28  
**Status:** ✅ **COMPLETE** — All critical gaps identified; remediation actions prioritized

**Next Steps:**
1. Implement Action 1 (Scenario E in runbook) — **Due: 2026-10-05**
2. Implement Action 2 (Prometheus alerts) — **Due: 2026-10-05**
3. Implement Action 3 (Slow-query metrics) — **Due: 2026-10-12**
4. Test updated runbook with full team — **Due: 2026-10-19**

---

**Attachments:**
- Drill timeline log (can be generated from Grafana audit logs)
- Indexer service logs during incident (for post-mortem analysis)
- Prometheus metrics snapshots during stalled cursor period
