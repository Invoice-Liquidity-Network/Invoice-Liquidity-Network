# Dead-Letter Handling for Unrecoverable Events Runbook (#1273)

This operational specification governs dead-letter queue containment for malformed, corrupt, or unparseable blockchain events.

## Invariant Protection

- **Poison Pill Containment**: Events with invalid XDR, unparseable topics, or non-numeric invoice IDs are routed to `deadLetterQueue` with reason `UNRECOVERABLE_EVENT`.
- **Non-Blocking Polling**: Quarantining unrecoverable events prevents the indexer and notifications poller from entering infinite restart crash loops.
- **Operator Inspection & DLQ Replay**: Operators can query quarantined events via `/dead-letter` and trigger manual replays once upstream schema fixes land.

## Verification

```bash
pnpm test:dead-letter-events
```
