# Release Rollback Criteria (Issue #1323)

This document establishes objective, metric-driven rollback thresholds for **SDK packages** and **production microservices** across the Invoice Liquidity Network.

## 1. SDK Rollback Criteria (`@iln/sdk`, `@iln/sdk-next`)

| Threshold Condition | Severity | Automated Action | Manual Escalation |
|---|---|---|---|
| Breaking XDR or transaction serialization mutation | CRITICAL | `NPM_DEPRECATE_AND_DOWNGRADE_PIN` | Page SDK Lead; publish advisory |
| Client-side unhandled exception rate > 1.0% | HIGH | Deprecate npm tag | Re-pin dependencies in `packages/react` and frontend |

## 2. Microservices Rollback Criteria (`indexer`, `oracle-service`, `notifications`)

| Service | Metric Threshold | Rollback Trigger | Recovery Procedure |
|---|---|---|---|
| **Indexer** | Cursor lag > 10 ledgers | `INDEXER_SYNC_LAG_EXCEEDED` | Rollback image tag; restore cursor from snapshot |
| **Notifications** | Delivery failure rate > 2.0% | `NOTIFICATIONS_FAILURE_RATE_EXCEEDED` | Revert dispatch worker image; replay dead letters |
| **Oracle** | P99 latency > 2.5s or stale > 1.0% | `ORACLE_P99_LATENCY_DEGRADED` | Fall back to direct RPC pricing endpoint |
| **All Services** | Crash loop ≥ 3 crashes in 15 mins | `SERVICE_CRASH_LOOP_DETECTED` | Trigger automated canary rollback |

## 3. Automation & Verification

Run automated rollback evaluation suite:
```bash
pnpm test:rollback-criteria
```
