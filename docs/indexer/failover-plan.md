# Multi-Region Indexer Failover Plan

## Objective
To ensure continuous availability of indexed data during a regional outage by maintaining a hot standby indexer in a secondary region.

## Architecture
- **Primary Region:** Processes all incoming events from the Stellar RPC and serves API traffic.
- **Secondary Region (Standby):** Runs an identical indexer instance but its API is not routed to by default. It indexes the same events in parallel to keep its local SQLite database up to date.

## Failover Procedure
1. **Detect Outage:** Monitoring alerts trigger when the primary region is unreachable or falls behind.
2. **DNS/Load Balancer Update:** Update routing rules to point API traffic to the secondary region.
3. **Verify State:** Ensure the secondary indexer is fully caught up with the latest ledger.
4. **Rehearsal:** We will rehearse this plan monthly by manually failing over traffic to the secondary region during low-traffic periods.

## Rehearsal Log
- [ ] Initial rehearsal pending.
