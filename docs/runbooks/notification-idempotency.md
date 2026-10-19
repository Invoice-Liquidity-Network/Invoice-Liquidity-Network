# Notification Delivery Idempotency Runbook (#1276)

This specification defines the dual-layer idempotency architecture for the notification subsystem:

## 1. Ingestion Layer Idempotency
- **In-Flight Lock**: `inFlightEvents` intercepts concurrent race conditions before database commits.
- **Durable Event Journal**: Events persisted in SQLite `events` table ensure replay safety across restarts.
- **Duplicate Metrics**: Intercepted duplicates increment `iln_notifications_duplicates_skipped_total`.

## 2. Dispatch & Outbound Layer Idempotency
- **Unique Dedup Key**: `dispatch_attempts` uses deterministic dedup keys combining invoice ID, trigger, recipient, and destination.
- **Outbound Webhook Headers**: Sends standard `Idempotency-Key` and `X-ILN-Idempotency-Key` on every HTTP webhook dispatch.

## 3. Verification

```bash
pnpm test:notifications-idempotency
```
