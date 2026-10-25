# ILN Notification Service

A Node.js + Express backend service for sending Stellar ILN invoice notifications via email, webhook, and SMS.

## Architecture

The service follows a poll-deliver pipeline:

```
Stellar RPC
    │
    ▼
┌─────────┐    ┌───────────┐    ┌────────────┐    ┌─────────────┐
│  Poller  │───▶│ Processor │───▶│  Delivery  │───▶│ Email/Webhook/SMS │
└─────────┘    └───────────┘    └────────────┘    └─────────────┘
                    │
                    ▼
              ┌──────────┐
              │ Scheduled│  (due_soon, overdue)
              │ Notifs   │
              └──────────┘
```

### Poller (`src/poller.ts`)

Polls the Stellar Soroban contract for events in batches of 200. Maintains a cursor ledger in SQLite to avoid reprocessing. On startup, resumes from the last stored cursor (or falls back to `NOTIFICATIONS_START_LEDGER` or the latest ledger minus 1000). Uses exponential backoff on retryable errors with a maximum of 5 consecutive retries before extended pause.

### Processor (`src/processor.ts`)

Decodes each contract event via `scValToNative`, deduplicates by event ID, journals it in `event_inbox`, fetches the invoice from the contract via RPC simulation, upserts it into the local SQLite DB and dispatches notifications. The `events` row is written only after that succeeds, so a failed fetch never leaves an event recorded-but-unprocessed; failures retry with exponential backoff and are dead-lettered after `NOTIFICATIONS_EVENT_MAX_ATTEMPTS` (see [Runbook: event ingestion](#runbook-event-ingestion-dead-letter-retry-and-replay)). Maps event types to notification triggers:

| Event Type | Trigger | Recipients |
|---|---|---|
| `funded` | `invoice_funded` | Freelancer, Payer |
| `paid` | `invoice_paid` | Freelancer, LP (funder) |
| `defaulted` | `invoice_defaulted` | LP (funder) |
| — | `invoice_due_soon` | LP (funded invoices due within `DUE_WARNING_HOURS`) |
| — | `invoice_overdue` | Payer |

### Delivery (`src/delivery.ts`)

Routes notifications to channel-specific senders:

- **Email**: Via [Resend](https://resend.com) SDK. Sends HTML-rendered emails with HMAC-signed unsubscribe links.
- **Webhook**: HTTP POST with HMAC signature in `X-ILN-Signature` header. Retries up to 3 times with exponential backoff (base 500ms). Logs delivery attempts to `webhook_delivery_logs` table.
- **SMS**: Via [Twilio](https://www.twilio.com). Requires `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER`.

Failed deliveries after exhausting retries are placed in a dead-letter queue
for inspection via the retry metrics endpoint. A destination that exhausts its
retry budget is circuit-broken for 60 seconds; subsequent delivery attempts
fail immediately for that destination while other destinations continue.

### Multi-Channel Delivery (`src/multi-channel.ts`)

Alternative delivery path supporting concurrent multi-channel delivery with fallback chains. Uses injectable adapter interfaces (`EmailAdapter`, `SmsAdapter`, `WebhookAdapter`) for testability.

### Digest (`src/digest.ts`)

Buffers notification events for users preferring daily or weekly digests. The `DigestScheduler` ticks at a configurable interval (default 1 minute), flushes accumulated events on schedule boundary, and renders HTML via `digest.template.ts`. Digests are sent to the address's ownership-verified email subscription, never to the raw Stellar address.

### Digest reconciliation (`src/digest-reconciliation.ts`)

Before each digest is sent it is reconciled against the persisted `events` and `invoices` tables (see [Runbook](#runbook-digest-reconciliation)). Registrations, pending items and a flush watermark are stored in SQLite, so digests survive restarts and replays without duplicating or dropping lines.

### Address ownership verification (`src/ownership.ts`)

Subscribing requires proof that the caller controls the Stellar address: a single-use challenge signed with the address's ed25519 key (see [Runbook](#runbook-address-ownership-verification)). The processor never delivers to a subscription without `ownership_verified_at`.

### Rate Limiter (`src/rate-limiter.ts`)

Sliding-window rate limiting combines a per-user bucket with a bucket scoped
to each `(channel, destination)` recipient. One busy email address, webhook URL,
or phone number therefore cannot consume another recipient's quota. Configure
the recipient threshold with `RATE_LIMIT_PER_RECIPIENT`; the legacy
`RATE_LIMIT_PER_CHANNEL` variable remains a fallback.

## User Preferences

Users control notification behavior via the preferences API (`src/preferences-api.ts`):

- **Channels**: Enable/disable email, webhook, or SMS independently
- **Frequency**: `realtime`, `daily`, or `weekly` digest
- **Quiet hours**: Suppress delivery during a configurable time window (with timezone support)
- **Per-trigger overrides**: Enable/disable individual event types (e.g., disable `invoice_funded` but keep `invoice_paid`)

### API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Service health check |
| `POST` | `/subscribe/challenge` | Issue a single-use ownership challenge for a Stellar address |
| `POST` | `/subscribe` | Create notification subscription (requires `challenge_nonce` + `signature`) |
| `POST` | `/subscriptions/verify` | Re-verify ownership for all of an address's subscriptions |
| `GET` | `/metrics/ownership` | Ownership-verification counters |
| `GET` | `/metrics/digest-reconciliation` | Digest reconciliation counters and last report |
| `DELETE` | `/unsubscribe` | Remove subscription |
| `GET` | `/subscriptions/:address` | List subscriptions for address |
| `GET` | `/subscriptions/:id/logs` | Webhook delivery logs |
| `POST` | `/test-webhook` | Test webhook endpoint |
| `GET` | `/analytics` | Delivery analytics |
| `GET` | `/analytics/channel-comparison` | Channel performance comparison |
| `GET` | `/analytics/trends?days=N` | Delivery trends over time |
| `GET` | `/preferences/:address` | Get user preferences |
| `PUT` | `/preferences/:address` | Create/update preferences |
| `PATCH` | `/preferences/:address` | Partial update preferences |
| `DELETE` | `/preferences/:address` | Reset preferences to defaults |
| `POST` | `/preferences/:address/unsubscribe` | One-click unsubscribe |
| `POST` | `/preferences/unsubscribe/token/:token` | Token-based unsubscribe |
| `GET` | `/preferences/:address/export` | GDPR data export |

## Local Development

### Prerequisites

- Node.js 20+
- A Stellar RPC endpoint (public testnet works for development)
- Resend API key (for email delivery)
- (Optional) Twilio credentials (for SMS)

### Setup

1. Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

Required environment variables:

| Variable | Description |
|---|---|
| `NOTIFICATIONS_RPC_URL` | Stellar RPC endpoint URL |
| `NOTIFICATIONS_CONTRACT_ID` | Soroban contract ID to poll |
| `NOTIFICATIONS_NETWORK_PASSPHRASE` | Stellar network passphrase |
| `RESEND_API_KEY` | Resend API key for email delivery |

Optional:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4001` | HTTP server port |
| `NOTIFICATIONS_START_LEDGER` | `0` (auto) | Starting ledger for event polling |
| `NOTIFICATIONS_POLL_INTERVAL_MS` | `30000` | Polling interval in milliseconds |
| `RESEND_FROM_EMAIL` | `no-reply@invoice-liquidity.network` | Sender email address |
| `DUE_WARNING_HOURS` | `48` | Hours before due date to send warning |
| `RATE_LIMIT_PER_USER` | `60` | Subscription/test requests per user per window |
| `RATE_LIMIT_PER_RECIPIENT` | `200` | Requests per channel and destination per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Sliding rate-limit window in milliseconds |
| `OWNERSHIP_CHALLENGE_TTL_MS` | `600000` | Lifetime of an ownership challenge (valid strictly before expiry) |
| `TWILIO_ACCOUNT_SID` | — | Twilio account SID for SMS |
| `TWILIO_AUTH_TOKEN` | — | Twilio auth token |
| `TWILIO_FROM_NUMBER` | — | Twilio phone number |

2. Install dependencies:

```bash
pnpm install
```

3. Start the service:

```bash
pnpm dev
```

The HTTP server starts on `http://localhost:4001` and the WebSocket server on `ws://localhost:4002/ws`.

### Triggering a Test Notification

Use the test webhook endpoint:

```bash
curl -X POST http://localhost:4001/test-webhook \
  -H "Content-Type: application/json" \
  -d '{"address": "YOUR_STELLAR_ADDRESS"}'
```

Or subscribe via the API and poll for real events. First request a challenge, sign
its `message` with the address's secret key, then subscribe with the proof:

```bash
curl -X POST http://localhost:4001/subscribe/challenge \
  -H "Content-Type: application/json" \
  -d '{"stellar_address": "YOUR_STELLAR_ADDRESS"}'
# → {"challenge": {"nonce": "...", "message": "...", "expires_at": 1700000600000}}

# Sign challenge.message, e.g. with @stellar/stellar-sdk:
#   Keypair.fromSecret(SECRET).sign(Buffer.from(message, 'utf8')).toString('base64')

curl -X POST http://localhost:4001/subscribe \
  -H "Content-Type: application/json" \
  -d '{
    "stellar_address": "YOUR_STELLAR_ADDRESS",
    "channel": "email",
    "destination": "you@example.com",
    "triggers": ["invoice_funded", "invoice_paid"],
    "challenge_nonce": "<challenge.nonce>",
    "signature": "<base64 signature>"
  }'
```

## Testing

```bash
pnpm test            # Run all tests
pnpm test:coverage   # Run with coverage report
pnpm test:watch      # Run in watch mode
```

## Database

The service uses SQLite via `better-sqlite3` (default path: `notifications.sqlite`). Tables:

- `invoices` — Invoice records synced from the contract
- `events` — Processed contract events (deduplication key); written only after the invoice was retrieved and notifications dispatched
- `event_inbox` — Durable chain-event journal (`pending` / `processed` / `dead`) with attempt count, backoff and dead-letter reason
- `cursor` — Last processed ledger position
- `subscriptions` — User notification subscriptions
- `sent_notifications` — Delivered notification log (idempotency)
- `webhook_delivery_logs` — Per-attempt webhook delivery tracking
- `ownership_challenges` — Single-use address ownership challenges (`consumed_at` blocks replay)
- `digest_state` — Digest registrations and the reconciliation watermark (`last_flushed_at`)
- `digest_pending` — Buffered digest items, restored on startup
- `digest_deliveries` — Event ids already included in a sent digest

## Erasure requests

Erasure is an operator-mediated workflow because the notification API cannot
prove that a requester controls a Stellar address. Verify identity through a
signed wallet challenge or equivalent approved account proof, then call
`POST /preferences/erasure/:address` with JSON `{ "requestId": "...",
"operatorId": "..." }` and `Authorization: Bearer <ERASURE_OPERATOR_TOKEN>`.
Configure `ERASURE_OPERATOR_TOKEN` to a high-entropy value of at least 32
characters. Do not expose the endpoint without network controls, and never use
an address supplied by itself as identity proof. See
[`docs/privacy.md`](../docs/privacy.md) for scope, retained/anonymized audit
data, confirmation, and backup handling.

## Runbook: address ownership verification

**Control:** `notification-address-ownership-verification` (#1281). **Owner:** notifications service maintainers.

- **Invariant:** a notification is only delivered to a subscription whose `ownership_verified_at` is set, which happens only after a valid ed25519 signature over a fresh, unexpired, unconsumed challenge for that exact address.
- **Evidence the control is active:** `GET /metrics/ownership` returns `challengesIssued`, `verified`, `rejected` (by reason: `missing_proof`, `invalid_signature`, `replayed`, `expired`, `address_mismatch`, `unknown_challenge`, `invalid_address`), `deliveriesBlockedUnverified`, `digestsBlockedNoVerifiedEmail` and the durable `unverifiedSubscriptions` gauge. Blocked deliveries and rejections log `[ownership] ...` JSON lines.
- **Fail-closed behaviour:** if SQLite cannot be read, `/subscribe` and `/subscriptions/verify` return `503`; no subscription is created.
- **Migration:** subscriptions created before this control are migrated with `ownership_verified_at = NULL` and stop receiving notifications. **Recovery:** the owner calls `POST /subscribe/challenge`, signs the message, and submits `POST /subscriptions/verify` with `stellar_address`, `challenge_nonce`, `signature`; all of the address's subscriptions are re-enabled.
- **Cross-package impact:** `sdk/src/notifications.ts` (`subscribeEmail` / `subscribeWebhook`) does not yet send an ownership proof and will receive `401` until it is updated to request and sign a challenge.

## Runbook: digest reconciliation

**Control:** `digest-reconciliation-against-invoice-events` (#1282). **Owner:** notifications service maintainers.

- **Invariant:** every line in a sent digest corresponds to a persisted invoice event (or a scheduled trigger) the recipient is entitled to, appears at most once, and is never re-sent; every such event in the window `(last_flushed_at, now]` is included.
- **Evidence the control is active:** each digest flush logs one `[digest-reconcile]` JSON report (`kept`, `backfilled`, `duplicates`, `alreadyDelivered`, `orphaned`, `mismatched`, `unresolved`). `GET /metrics/digest-reconciliation` returns cumulative `totals`, `runs`, `failures` and the `lastReport`.
- **Fail-closed behaviour:** if reconciliation cannot read the event store, the flush throws, no email is sent, and the buffer (and `digest_pending`) is kept for the next tick; `failures` increments.
- **Unresolved events** (event stored but its invoice fetch failed; since #1274 new events are only stored after the invoice is retrieved, so this applies to rows written by older versions) keep the watermark before them, so they are backfilled on a later flush once the invoice is stored. A sustained non-zero `unresolved` means the RPC `get_invoice` path is failing — check `[rpc]` logs.
- **Restart:** on startup `digestScheduler.restore()` reloads registrations and pending items from SQLite, then `digestScheduler.start()` resumes ticking.

## Runbook: event ingestion (dead-letter, retry and replay)

**Control:** `event-inbox-bounded-retry-dead-letter` (#1273, #1274, #1275, #1276). **Owner:** notifications service maintainers.

- **Invariant:** every contract event the poller sees is journaled in `event_inbox` before any RPC call and ends `processed` (invoice retrieved, notifications dispatched, `events` row written) or `dead` (terminal, operator-visible). The cursor may advance past an event once it is journaled, so a failed `get_invoice` can no longer lose it.
- **Bounded retry:** a failed attempt leaves the event `pending` with `next_attempt_at = now + min(NOTIFICATIONS_EVENT_RETRY_MAX_MS, NOTIFICATIONS_EVENT_RETRY_BASE_MS * 2^(attempts-1))` (defaults 5 s base, 5 min cap). After `NOTIFICATIONS_EVENT_MAX_ATTEMPTS` (default 6) the event is dead-lettered as `max_attempts_exhausted`. A payload that cannot be decoded is dead-lettered immediately as `malformed_event` and never stalls the poller.
- **Idempotence:** replayed polls skip processed, pending and dead events; notification sends are additionally deduplicated by the `dispatch_attempts` key, so a crash between delivery and closing the event re-sends nothing.
- **Evidence the control is active:** `GET /metrics` exposes `iln_notifications_event_ingest_total{result,reason}` (`processed`, `retry`, `dead_lettered`, `duplicate`) and `iln_notifications_event_inbox{status}` (`pending`, `processed`, `dead`, `oldest_pending_age_seconds`, `max_pending_attempts`). Dead-lettering logs `[processor] Event <id> dead-lettered (...)`. **Alert on** `iln_notifications_event_inbox{status="dead"} > 0` or a growing `oldest_pending_age_seconds`.
- **Triage:** `tsx src/audit-cli.ts --event-summary` (exit code 3 when any event is dead) and `--event-list dead|pending|processed`.
- **Recovery:** fix the cause (usually the RPC `get_invoice` path — check `[rpc]` logs), then `tsx src/audit-cli.ts --event-requeue <event-id> --operator <operator-id>`. This resets the attempt budget, is recorded in the signed compliance audit chain, and the next poll retries it. `malformed_event` rows cannot be re-queued.
- **Migration / compatibility:** `event_inbox` is created automatically (`CREATE TABLE IF NOT EXISTS`); the `events` table and every API are unchanged. Events recorded by older versions without a retrievable invoice are not recoverable by this control. No other service changes are required.
- **Validation:** `tests/event-ingest.test.ts` (success, failed fetch, backoff boundary, retry-budget boundary, restart, replay, dead-letter and re-queue).
