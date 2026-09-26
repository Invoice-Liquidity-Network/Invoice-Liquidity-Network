- closes #1048
- closes #1046
- closes #1044
- closes #1043

# Changes Made

- **Failover Plan (#1048):** Added a new failover plan document at `docs/indexer/failover-plan.md` detailing architecture, outage detection, failover procedure, and a rehearsal log. Added the new document to the `_meta.json`.
- **Query Performance Budgets (#1046):** Enforced performance budgets by changing the warning to throw an error if a query exceeds the `SLOW_QUERY_THRESHOLD_MS` budget in `indexer/src/db.ts`. This ensures heaviest documented queries fail fast instead of lagging.
- **State Reconciliation Job (#1044):** Added a new scheduled job in `indexer/src/reconciliation.ts` which iterates over all stored invoices, fetches their latest live state via RPC, and upserts/corrects any discrepancies automatically. This runs automatically on startup and on an interval. It was wired up in `indexer/src/index.ts`.
- **Indexer Idempotency (#1043):** Updated event processing logic in `indexer/src/processor.ts` to verify if the incoming event's state updates actually modify the current database state before performing an `upsertInvoice` or triggering pubsub updates. This prevents duplicate and out-of-order events from spamming identical updates and incorrectly bumping `updated_at` timestamps.
