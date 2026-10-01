# API Collection

This document comprehensively catalogs every API endpoint exposed by the Invoice Liquidity Network (ILN), covering Soroban RPC, Stellar Horizon, and the three ILN services (indexer, oracle-service, notifications).

The Postman/Bruno collections for Soroban RPC and Horizon are available in `examples/api-collection/`:

- `iln.bru` — Bruno-compatible collection
- `iln.postman_collection.json` — Postman v2.1 compatible equivalent

**This document is the single source of truth for endpoint completeness.** CI enforcement (see [CI Drift Prevention](#ci-drift-prevention)) prevents gaps from growing.

---

## Stellar Network APIs

### Horizon (Testnet)

Horizon provides account and transaction data for the Stellar network. ILN indexers use this for account state inspection and transaction history.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/accounts/{account_id}` | Fetch account data and balances |
| GET | `/accounts/{account_id}/transactions` | List transactions for an account |
| GET | `/ledgers` | List recent ledgers |
| GET | `/transactions/{tx_hash}` | Fetch transaction by hash |
| POST | `/transactions` | Submit signed transaction |
| GET | `/operations?account_id={id}` | List operations for an account |
| GET | `/effects?account_id={id}` | List effects for an account |

**Live URLs:**
- Testnet: `https://horizon-testnet.stellar.org`
- Public: `https://horizon.stellar.org` (mainnet)

### Soroban RPC (Testnet)

Soroban RPC provides contract simulation, submission, and event querying for smart contracts on Stellar.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/` (JSON-RPC 2.0) | `getLatestLedger` — fetch current ledger number |
| POST | `/` (JSON-RPC 2.0) | `getTransaction` — fetch transaction status by XDR |
| POST | `/` (JSON-RPC 2.0) | `sendTransaction` — submit signed XDR to the network |
| POST | `/` (JSON-RPC 2.0) | `simulateTransaction` — simulate contract invocation without submitting |
| POST | `/` (JSON-RPC 2.0) | `getEvents` — query contract events by ledger range or cursor |
| POST | `/` (JSON-RPC 2.0) | `getContractData` — fetch contract storage by key |
| POST | `/` (JSON-RPC 2.0) | `getNetwork` — fetch network identifier and passphrase |

**Live URLs:**
- Testnet: `https://soroban-testnet.stellar.org`
- Public: `https://mainnet.stellar.sorobanrpc.com` (mainnet)

---

## ILN Service APIs

### Indexer Service

The indexer ingests on-chain events, maintains a complete invoice state history, and exposes queryable REST and GraphQL endpoints. Testnet: `http://localhost:3001` (development); production URL varies by deployment.

#### Health & Metrics

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Service health check (deprecated; use `/v1/health`) |
| GET | `/v1/health` | Service health with database and sync status |
| GET | `/metrics` | Prometheus metrics (OpenTelemetry format) |
| GET | `/v1/metrics` | Prometheus metrics (OpenTelemetry format) |

#### GraphQL

| Method | Endpoint | Purpose |
|---|---|---|
| GET/POST | `/graphql` | GraphQL queries, mutations, subscriptions; includes GraphiQL IDE |

#### REST Queries (Invoices)

| Method | Endpoint | Parameters | Purpose |
|---|---|---|---|
| GET | `/invoices` or `/v1/invoices` | `?status=Pending\|Funded\|Paid\|Defaulted&freelancer=G...&payer=G...&funder=G...&limit=100&cursor=opaque` | List invoices with pagination; filters ANDed together |
| GET | `/invoice/:id` or `/v1/invoice/:id` | `:id` = invoice ID | Fetch a single invoice by ID |
| GET | `/stats` or `/v1/stats` | — | Protocol-wide statistics (total volume, invoice count, etc.) |
| GET | `/history/:address` or `/v1/history/:address` | `?role=freelancer\|payer\|funder` | Invoice history for one address in a specific role |
| GET | `/lps/top` or `/v1/lps/top` | `?limit=10&period=all\|week\|month` | Top liquidity providers by funding volume |
| GET | `/lps/:address/stats` or `/v1/lps/:address/stats` | `:address` = Stellar address | LP-specific stats (total funded, yield, default rate) |
| GET | `/freelancers/:address/stats` or `/v1/freelancers/:address/stats` | `:address` = Stellar address | Freelancer-specific stats (invoices created, volume, paid rate) |

#### Backup & Recovery

| Method | Endpoint | Parameters | Purpose |
|---|---|---|---|
| GET | `/backup` | — | List all available backups |
| GET | `/backup/latest` | — | Fetch manifest of latest backup |
| POST | `/backup` | — | Trigger immediate backup creation |
| POST | `/backup/restore` | `{ backupPath, verify: boolean }` | Restore database from backup |

#### Export (Bulk Data)

Streaming, paginated exports with strict row and byte budgets.

| Method | Endpoint | Parameters | Purpose |
|---|---|---|---|
| GET | `/export/invoices` or `/v1/export/invoices` | `?format=csv\|json&from=ISO&to=ISO&status=...&freelancer=...&payer=...&funder=...&cursor=opaque` | Stream invoices; split across multiple requests with resumption cursor if needed |
| GET | `/export/events` or `/v1/export/events` | `?format=csv\|json&from=ISO&to=ISO&invoiceId=...&cursor=opaque` | Stream events; split across requests with resumption cursor if needed |
| POST | `/export/jobs` or `/v1/export/jobs` | `{ type: "invoices"\|"events", format: "csv"\|"json", ...filters, cursor? }` | Create async export job (responds 202; job runs in background) |
| GET | `/export/jobs/:jobId` or `/v1/export/jobs/:jobId` | `:jobId` = job UUID | Poll job status, rowCount, error, and resumption cursor |
| GET | `/export/download/:jobId` or `/v1/export/download/:jobId` | `:jobId` = job UUID | Download completed export as file |

#### Archive Management

| Method | Endpoint | Parameters | Purpose |
|---|---|---|---|
| GET | `/archive/stats` or `/v1/archive/stats` | — | Stats on archived invoices and events |
| GET | `/archive/invoices` or `/v1/archive/invoices` | `?status=...&freelancer=...&payer=...&funder=...` | Query archived invoices |
| GET | `/archive/events` or `/v1/archive/events` | `?invoiceId=...` | Query archived events by invoice |
| POST | `/archive/restore/:id` | `:id` = invoice ID | Restore a single archived invoice and its events |
| POST | `/archive/run` | `{ olderThanDays: number }` | Run archival job on invoices older than N days |

#### Dashboard

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/dashboard` or `/v1/dashboard` | Dashboard metrics (TVL, fees, activity sparklines) |

#### Documentation

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/docs` | Swagger/OpenAPI UI (rendered spec) |

---

### Oracle Service

The oracle service computes trust scores for payers, detects fraud signals, and verifies on-chain reputation. Testnet: `http://localhost:3010` (development); production URL varies by deployment.

#### Health & Metrics

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Service health check (deprecated; use `/v1/health`) |
| GET | `/v1/health` | Service health with SLO violation snapshot |
| GET | `/metrics` | Prometheus metrics (OpenTelemetry format) |
| GET | `/v1/metrics` | Prometheus metrics (OpenTelemetry format) |

#### Verification

| Method | Endpoint | Body | Purpose |
|---|---|---|---|
| POST | `/verify` or `/v1/verify` | `{ payer: Stellar address, invoiceId?: number, verified?: boolean }` | Request payer verification (returns verdict with confidence, fraud flags, reputation snapshot); supports optional KYB override |
| GET | `/v1/verify` | — | Error: use POST |

#### Signing Configuration

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/v1/signing/config` | Oracle's current signing key ID and rotation schedule (for attestation verification) |

#### Audit Trail

| Method | Endpoint | Query Parameters | Purpose |
|---|---|---|---|
| GET | `/v1/audit/entries` | `?from=ISO&to=ISO&payer=address&invoiceId=...&limit=1000&offset=0` | Query published verdicts with filters and pagination |
| GET | `/v1/audit/integrity` | — | Verify audit trail integrity (recompute hash chain and HMACs) |

#### Delta Bounds (Over-Large Update Hold)

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/v1/oracle/delta-holds` | Query updates held for human review (reputation deltas beyond configured bounds) |

#### Cache Management

| Method | Endpoint | Body | Purpose |
|---|---|---|
| POST | `/v1/cache/invalidate` | `{ payer: Stellar address, invoiceId?: number }` | Invalidate cached verdict for payer (forces recomputation on next request) |

---

### Notifications Service

The notifications service delivers event-driven alerts via webhook, email, SMS, and WebSocket, with preferences management and delivery audit logging. Testnet: `http://localhost:3011` (development); production URL varies by deployment.

#### Health & Metrics

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Service health check |
| GET | `/metrics` | Prometheus metrics (OpenTelemetry format) |
| GET | `/health/providers` | Health status of all delivery providers (email, SMS, webhook, WebSocket) |

#### Subscriptions

| Method | Endpoint | Body | Purpose |
|---|---|---|
| POST | `/subscribe` | `{ stellar_address, channel: "webhook"\|"email"\|"sms", destination, triggers: [...], webhook_secret?: hex }` | Create notification subscription |
| DELETE | `/unsubscribe` | `{ id?: number, address?: string, destination?: string }` | Delete subscription (by ID or address+destination) |
| GET | `/subscriptions/:address` | — | List all subscriptions for an address |

#### Webhook Testing

| Method | Endpoint | Body | Purpose |
|---|---|---|
| POST | `/test-webhook` | `{ id: subscription ID }` | Send test webhook to verify delivery |
| GET | `/subscriptions/:id/logs` | — | List webhook delivery logs for a subscription |

#### Analytics

| Method | Endpoint | Query | Purpose |
|---|---|---|
| GET | `/analytics` | — | Overall delivery analytics (success rates, latency percentiles) |
| GET | `/analytics/channel-comparison` | — | Per-channel delivery metrics |
| GET | `/analytics/trends` | `?days=30` | Time-series delivery trends (default 30 days, max 365) |

#### Delivery Audit Log

| Method | Endpoint | Query Parameters | Purpose |
|---|---|---|
| GET | `/audit/deliveries` | `?recipient=address&eventId=...&trigger=...&channel=...&status=pending\|delivered\|failed&start=ISO&end=ISO&limit=1000&offset=0` | Query delivery audit log with filters |
| GET | `/audit/deliveries/:id` | — | Fetch single audit record |
| GET | `/audit/stats` | — | Delivery counts by status (delivered, failed, pending) |
| POST | `/audit/purge` | `{ now?: ISO8601 }` or query `?now=ISO8601` | Purge expired logs (90-day retention); returns count |

#### Digest Preferences

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/digest/preview/:address` | Preview pending digest items and next send time (without sending) |
| GET | `/preferences/:address` | Fetch user's notification preferences (channel, frequency, disabled triggers) |
| PUT | `/preferences/:address` | Update preferences (frequency: immediate/daily/weekly, channel settings) |
| GET | `/preferences/unsubscribe/:token` | One-click unsubscribe by tokenized link (no auth required) |
| POST | `/preferences/export` | GDPR data export for an address |

---

## Included Variables (Postman/Bruno Collection)

## Collection Variables

The Postman/Bruno collection is pre-populated with testnet URLs and contract IDs:

- `horizon_url`: `https://horizon-testnet.stellar.org`
- `rpc_url`: `https://soroban-testnet.stellar.org`
- `iln_contract_id`: `CCPASLHKRFBMVV5PZG3LKDGKFEDXZMB5U7DK42CVLUVWCMUCSRPVBIMO`
- `distribution_contract_id`: `CAQGPMT3EQK4AABMIR66JJXEOCNCLPTDNXMS5OHZXH4LI24UYAF25V5B`
- `governance_contract_id`: `CD7GOIU3GNK7EZHG7VI4NRVGMRCU7X2FOCAPQN6EGTSW46BY4EB`

Placeholder variables for your own values:

- `account_id`, `invoice_id`, `transaction_hash`
- `get_invoice_tx_xdr`, `submit_invoice_tx_xdr`, `signed_submit_invoice_tx_xdr`
- `get_events_cursor`

## Example XDR Argument Patterns

### submit_invoice

Required arguments:
- `freelancer` (Address)
- `payer` (Address)
- `amount` (i128)
- `due_date` (u64)
- `discount_rate` (u32)

```json
[
  {"type": "address", "value": "G..."},
  {"type": "address", "value": "G..."},
  {"type": "i128", "value": "100000000"},
  {"type": "u64", "value": "1717065600"},
  {"type": "u32", "value": "300"}
]
```

### get_invoice

```json
[
  {"type": "u64", "value": "1"}
]
```

## How to Use

1. Open `examples/api-collection/iln.bru` in Bruno or import `examples/api-collection/iln.postman_collection.json` into Postman.
2. Replace placeholder variables with real values for your test.
3. Use Horizon requests for account/transaction inspection.
4. Use Soroban RPC for contract simulation and submission.
5. Use ILN service endpoints for invoice queries and analytics.

## CI Drift Prevention

**Automatic endpoint audits prevent undocumented APIs.** The CI suite includes:

1. **Route enumeration:** Scans indexer, oracle-service, and notifications source code for every HTTP method + path.
2. **Gap detection:** Compares discovered routes against this document's tables.
3. **Enforcement:** Build fails if an endpoint is:
   - Undocumented in this file (new route without doc entry)
   - Documented but no longer exists (stale doc entry)
4. **Resolution:** Update this file and redeploy; the CI passes once the doc matches the code.

**Implementation:** `scripts/audit-endpoints.ts` runs at CI time and reports findings as build errors, preventing runtime surprises.

---

## Endpoint Reference Summary

**Stellar Network:** Horizon (account/transaction data), Soroban RPC (smart contract interface)

**ILN Indexer:** Invoices, stats, LP/freelancer metrics, backups, exports, archive, dashboard

**ILN Oracle:** Payer verification, audit trail, fraud signal detection, signing config, cache invalidation

**ILN Notifications:** Subscriptions, webhook/email/SMS delivery, analytics, audit log, GDPR export, digest preview

## Indexer bulk-export resource limits

The indexer's bulk-export endpoints (`GET /v1/export/invoices`, `GET /v1/export/events`,
and the async job endpoints under `/v1/export/jobs`) stream results with true row-by-row
pagination — responses are produced from a streaming SQLite cursor, so server memory stays
flat regardless of result size. The following limits protect the process from
resource-exhaustion; every one is env-overridable and validated against the exact request.

### Hard caps (unchanged)

| Constant | Default | Behavior when exceeded |
|---|---|---|
| `SYNC` page cap | 5,000 rows | `413` on `GET /v1/export/*` — switch to an async job |
| `ASYNC` job cap | 50,000 rows | Job fails with `Result set too large` |

### Per-session budgets (streaming pagination)

A "session" is the sequence of requests needed to download one filtered export: the first
request, plus every follow-up made with the returned resumption cursor. Budgets are carried
across stateless requests inside the opaque cursor, so they hold even if intermediate
responses are dropped.

| Env var | Default | Meaning |
|---|---|---|
| `EXPORT_SESSION_MAX_ROWS` | 200,000 | Cumulative rows delivered in one session (across pages) |
| `EXPORT_SESSION_MAX_SECONDS` | 300 | Wall-clock budget per streamed response |
| `EXPORT_SESSION_MAX_BYTES` | 100,000,000 (100 MB) | Byte budget per streamed response |
| `EXPORT_PAGE_MAX_ROWS` | same as SYNC cap (5,000) | Rows per streamed page — forces mid-result cutoffs below the 413 line |

For async jobs:

| Env var | Default | Meaning |
|---|---|---|
| `EXPORT_JOB_TTL_SECONDS` | 1,800 | Finished jobs are evicted from memory after this TTL |
| `EXPORT_JOB_MAX` | 1,000 | Cap on tracked jobs; oldest finished jobs evict first |

### Truncation & resumption headers

When a session hits the row budget before the result set is exhausted (but the request is
still within the sync 413 line), the response is cut off **after a complete row** and carries:

- `X-Export-Truncated: true`
- `X-Export-Resumption-Cursor: <opaque base64 cursor>`

Resume by re-issuing the same request with `?cursor=<opaque cursor>` appended:

```bash
# first page (large export, sub-413 thanks to filters)
curl -D headers.txt "https://indexer/v1/export/invoices?format=json&status=Paid"

# if headers.txt shows X-Export-Truncated: true, continue the session:
curl -D headers.txt \
  "https://indexer/v1/export/invoices?format=json&status=Paid&cursor=$(grep -i x-export-resumption-cursor headers.txt | cut -d' ' -f2 | tr -d '\r')"
```

Repeat until `X-Export-Truncated` is absent. Resumed async jobs report `truncated` and
`resumptionCursor` in `GET /v1/export/jobs/:jobId`; the follow-up job is created by passing
`{ "cursor": "<resumptionCursor>", ... }` in the `POST /v1/export/jobs` body. If the
cumulative session row budget is exhausted, the server responds `413` with
`Export session row budget exhausted` — start a new session by omitting the cursor.

### Load test

`pnpm test:load:export` (requires a running indexer) drives concurrent streaming export
sessions, cursor pagination and async job lifecycles, and asserts error rate, p95 latency,
protocol correctness (truncated responses must carry a resumption cursor) and a server RSS
ceiling. See `scripts/load-test-indexer-export.ts` for flags.
