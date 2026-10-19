# Production KYB Outage Containment Rehearsal (Issue #1321)

This rehearsal documents and validates the operational containment procedures when an external Know Your Business (KYB) provider suffers a partial or complete outage.

## Invariant Guarantees

1. **Fail-Closed on Required Corridors**: If a regulatory corridor requires active KYB, provider unavailability strictly returns `rejected-kyb-unavailable`. Zero unverified funding occurs.
2. **Graceful Degradation on Standard Corridors**: For non-strict corridors, the oracle gracefully degrades to on-chain reputation history with reduced confidence (0.65 vs 0.95), logging the fallback.
3. **Multi-Provider Failover**: The incident commander can execute a hot-failover from primary (`veriff-primary-kyb`) to secondary (`trulioo-secondary-kyb`) in < 500ms.
4. **Audit & Evidence Retention**: Every rehearsal records a cryptographically signed evidence bundle stored under `.artifacts/drills/` retained for 90 days.

## Automated Execution

```bash
pnpm test:kyb-outage
```
