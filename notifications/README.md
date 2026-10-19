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

Decodes each contract event via `scValToNative`, deduplicates by event ID, fetches the invoice from the contract via RPC simulation, and upserts it into the local SQLite DB. Maps event types to notification triggers:

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
- `events` — Processed contract events (deduplication key)
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
- **Unresolved events** (event stored but its invoice fetch failed) keep the watermark before them, so they are backfilled on a later flush once the invoice is stored. A sustained non-zero `unresolved` means the RPC `get_invoice` path is failing — check `[rpc]` logs.
- **Restart:** on startup `digestScheduler.restore()` reloads registrations and pending items from SQLite, then `digestScheduler.start()` resumes ticking.
