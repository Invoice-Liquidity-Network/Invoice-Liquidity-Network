# KYB Provider Failover & Enforcement Invariants Runbook (#1238)

This operational specification governs high-availability KYB failover routing in the Oracle service.

## Enforcement Invariants

1. **Zero Enforcement Bypass**:
   - Failover to a secondary provider must NEVER bypass verification checks.
   - If an entity is unverified by the secondary provider (`isVerified: false`), the verdict is strictly rejected with `rejected-kyb-unverified`.
2. **Dual-Outage Fail-Closed**:
   - If both primary and secondary providers are unavailable, the request fails closed with `rejected-kyb-unavailable`.
3. **Telemetry & Audit Trace**:
   - Each verification response records `failoverAttempted: boolean` and `effectiveProvider: string` in audit metadata.

## Verification

```bash
pnpm test:kyb-failover
```
