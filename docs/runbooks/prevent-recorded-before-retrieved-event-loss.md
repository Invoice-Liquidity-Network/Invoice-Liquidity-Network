# Prevent Recorded-Before-Retrieved Event Loss Runbook (#1274)

This operational specification governs event ingestion ordering to prevent permanent event loss caused by premature database journaling.

## Invariant

- **Retrieve-Before-Record Invariant**: `fetchInvoice(invoiceId)` must succeed and return a valid invoice BEFORE `insertEvent()` records the event in SQLite.
- **Fail-Retry Behavior**: If invoice retrieval fails (RPC timeout, node lag, network blip), the event is not recorded, ensuring subsequent poll cycles can retry and deliver notifications.

## Verification

```bash
pnpm test:recorded-before-retrieved
```
