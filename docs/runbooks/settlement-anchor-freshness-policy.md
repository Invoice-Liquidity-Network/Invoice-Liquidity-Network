# Settlement-Anchor Freshness and Failure Policy Runbook (#1309)

This operational specification governs SLA requirements, quote freshness thresholds, and automated failover hierarchies for Stellar settlement anchors.

## 1. Freshness Policy

- **Exchange Quote Expiry**: Quotes older than 300 seconds (5 minutes) fail closed.
- **Heartbeat Timeout**: Anchor endpoints with missing telemetry > 120 seconds are automatically marked suspended.

## 2. Redundancy Invariant

- Every supported fiat corridor must maintain at least **two independent anchor partners** in active registration before enabling borrower off-ramp volume.

## 3. Failure Escalation Hierarchy

| State | Trigger | Operational Response |
|---|---|---|
| **HEALTHY** | Error rate < 5%, heartbeat < 120s | Normal primary routing |
| **DEGRADED** | Error rate ≥ 5% over 15m | Shift new volume to secondary anchor |
| **SUSPENDED** | Consecutive failures ≥ 5 or heartbeat > 120s | Trip circuit breaker, suspend corridor |

## 4. Verification

```bash
pnpm test:anchor-policy
```
