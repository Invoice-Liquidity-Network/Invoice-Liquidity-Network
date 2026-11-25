# Notification reliability operator workflow

This runbook defines the operational contract for notification polling, retries, crash recovery, and dead-letter handling.

## Event polling and checkpoints

The poller reads contract events in pages of 200. A cursor is written only after every event in the page has completed processing. If processing fails, the cursor remains at the previous durable boundary and the page is replayed on the next poll. Event IDs and dispatch deduplication make that replay safe.

Operators should:

1. Check the service health and event-inbox metrics.
2. Record the last cursor ledger before restarting a degraded instance.
3. Restart the instance; do not delete the SQLite database.
4. Confirm that the cursor advances after the replayed page is processed.
5. Investigate any event that reaches the dead state before replaying it.

## Retry and idempotency contract

Every notification intent is persisted in dispatch_attempts before a provider call. The row's dedup_key is unique and combines invoice, trigger, recipient, channel, destination, and event identity. Retries reuse that row and increment its attempt count; they never create a second intent.

A provider success is recorded in sent_notifications and closes the dispatch row as delivered. If the process exits after the provider accepts a request but before the database update, the next flush sees the sent-notification record and closes the pending row without sending again. Permanent failures and exhausted retries become failed and require an explicit operator replay.

## Crash-recovery verification

After a crash or forced restart, verify:

- pending inbox events are retried;
- delivered notifications are not sent a second time;
- dispatch attempts retain their original deduplication key and attempt history;
- a failed event does not advance the polling cursor beyond its page;
- the restarted process drains pending work before normal polling continues.

The integration tests in notifications/tests/crash-recovery.test.ts exercise the provider hand-off crash window. Keep these checks enabled in CI.

## Dead-letter operator workflow

Dead-letter entries are not silently discarded. For each entry:

1. Inspect the event/attempt id, channel, provider error, attempt count, and timestamps.
2. Classify the failure as transient provider outage, invalid destination, policy rejection, or malformed chain event.
3. Correct the provider or subscription configuration when the failure is actionable.
4. Replay one entry and observe the delivery audit and dispatch status.
5. Stop replaying entries that fail permanently; escalate with the entry id and error.
6. After a bulk incident, verify the dead-letter count and retry metrics return to baseline.

Never edit SQLite rows by hand. Use the dead-letter/replay API or the service's operator tooling so audit records and idempotency checks remain intact.

## Alerting and hand-off

Page the on-call operator when dead-letter counts grow continuously, the event cursor is unchanged across two poll intervals, or the pending queue age exceeds the service objective. Include the cursor ledger, event/attempt ids, provider response class, and the first observed timestamp in the incident hand-off. Do not include recipient addresses or webhook secrets in logs or tickets.
