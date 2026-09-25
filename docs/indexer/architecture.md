# Architecture

This document describes the architecture of the ILN Indexer service.

## System Overview

The ILN Indexer is a Node.js service that:

1. Polls Stellar RPC nodes for contract events
2. Processes and stores invoice data in SQLite
3. Serves a REST API for querying the indexed data

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        ILN Indexer                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   Poller    │───▶│  Processor  │───▶│   Database  │         │
│  │             │    │             │    │   (SQLite)  │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
│         │                                     │                 │
│         │                                     ▼                 │
│         │                              ┌─────────────┐         │
│         │                              │  REST API   │         │
│         │                              │  (Express)  │         │
│         │                              └─────────────┘         │
│         │                                     │                 │
│         │                                     ▼                 │
│         │                              ┌─────────────┐         │
│         │                              │   Cache     │         │
│         │                              │ (Memory/Redis)│       │
│         │                              └─────────────┘         │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────┐                                               │
│  │ Stellar RPC │                                               │
│  │    Node     │                                               │
│  └─────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Poller (`poller.ts`)

The Poller is responsible for fetching events from the Stellar blockchain.

**Key Responsibilities**:
- Determine the starting ledger for polling
- Fetch events in batches (200 events per batch)
- Handle pagination using cursors
- Manage the stored cursor position

**Polling Strategy**:
1. On first run, starts from `START_LEDGER` or automatically detects (latest - 1000 ledgers)
2. Re-scans from the last processed ledger on each poll for resilience
3. Processes events in batches to handle large volumes
4. Advances the cursor only after successful processing

**Resilience**:
- Re-scans the last processed ledger to handle ledger re-orgs
- Event deduplication ensures no duplicate processing
- Errors are logged but don't stop the polling loop

### 2. Processor (`processor.ts`)

The Processor handles individual contract events.

**Event Processing Flow**:
1. **Deduplication**: Check if event ID has been processed before
2. **Decoding**: Extract event type and invoice ID from Soroban values
3. **Persistence**: Store event record in SQLite
4. **State Sync**: Fetch current invoice state from RPC and upsert

**Supported Event Types**:
- `submitted` - New invoice created
- `funded` - Invoice funded by LP
- `paid` - Invoice marked as paid
- `defaulted` - Invoice defaulted

**Why Fetch from RPC?**
The processor always fetches the current invoice state from the RPC node rather than parsing all fields from events. This ensures:
- Accurate state even if events are processed out-of-order
- Handles ledger re-orgs gracefully
- Simplifies event processing logic

### 3. Database (`db.ts`)

SQLite database with WAL mode for concurrent read performance.

**Schema**:

```sql
-- Invoices table
CREATE TABLE invoices (
  id            INTEGER PRIMARY KEY,
  freelancer    TEXT    NOT NULL,
  payer         TEXT    NOT NULL,
  amount        TEXT    NOT NULL,  -- i128 stored as string
  due_date      INTEGER NOT NULL,
  discount_rate INTEGER NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'Pending',
  funder        TEXT,
  funded_at     INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Events table for deduplication
CREATE TABLE events (
  event_id         TEXT    PRIMARY KEY,
  event_type       TEXT    NOT NULL,
  invoice_id       INTEGER NOT NULL,
  ledger           INTEGER NOT NULL,
  ledger_closed_at TEXT    NOT NULL,
  created_at       INTEGER NOT NULL
);

-- Cursor table for tracking sync position
CREATE TABLE cursor (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  last_ledger  INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);
```

**Indexes**:
- `idx_invoices_status` - Fast status filtering
- `idx_invoices_freelancer` - Fast freelancer queries
- `idx_invoices_payer` - Fast payer queries
- `idx_invoices_funder` - Fast funder queries
- `idx_events_invoice_id` - Fast event lookup by invoice

### 4. REST API (`api.ts`)

Express-based HTTP server with middleware for:
- Rate limiting
- JSON parsing
- Trust proxy configuration

**Middleware Stack**:
1. Trust proxy (for rate limiting behind reverse proxies)
2. Rate limiter
3. JSON body parser
4. Route handlers

### 5. Cache (`cache.ts`)

Two-tier caching system:
1. **In-memory**: Default, fast, no external dependencies
2. **Redis**: Optional, distributed, persists across restarts

**Cache Strategy**:
- Invoice queries are cached for 60 seconds
- Cache is invalidated when new events are processed
- Stats are cached for 30 seconds

### 6. Admin Dashboard (`dashboard.ts`) and its access model

The admin dashboard is served at `GET /v1/dashboard` (and the unversioned
`GET /dashboard` alias for backwards compatibility). It is a **public,
unauthenticated** operational metrics endpoint.

**Access model**

| Question | Answer |
|---|---|
| Who can reach it? | Anyone with network access to the indexer HTTP port |
| Authentication? | None — no API key, token, or session is required |
| Rate limiting? | Yes — the global per-IP limiter applies (default 100 req/min) |
| What data is exposed? | Sync state, request/query counters, error counts and rates, uptime, and process memory usage |
| What data is NOT exposed? | Invoice/event rows, addresses, credentials, file paths, stack traces |

**Why it is safe to expose without auth**: the endpoint deliberately returns
only *aggregated* counters and a sanitized last-error string. Every error
message that enters the metrics (`recordError`) is passed through
`sanitizeOperationalError`, which:

1. Drops everything after the first line of a message (stack traces are cut).
2. Redacts connection strings (`postgres://…`, `mysql://…`, `redis://…`, …).
3. Redacts `user:password@` credentials inside any URL scheme.
4. Redacts `key=value` / `key: value` pairs for well-known secret field names
   (`api_key`, `token`, `secret`, `password`, …), including JSON-quoted forms.
5. Redacts `Authorization` header values (`Bearer` / `Basic` / `Digest`).
6. Redacts AWS-style access key IDs and common filesystem paths.
7. Truncates the result to 240 characters.

The metrics query path is also failure-tolerant: if the database query fails,
the dashboard returns `null` sync fields with a `200` rather than surfacing a
`500` with error details to the caller.

**Deployment guidance**: because the endpoint is public, do not put anything
sensitive in fields that flow through `recordError`. If operational metrics
must be private (e.g. in a shared environment), put the indexer behind a
reverse proxy that restricts access to `/v1/dashboard`.

### 7. GraphQL subscriptions and pub-sub (`graphql/pubsub.ts`)

The indexer has a single canonical pub-sub event bus at
`src/graphql/pubsub.ts`, backed by `graphql-subscriptions`. Both GraphQL
surfaces share it:

- **Legacy monolithic Yoga schema** (`graphql.ts`) — served over HTTP/SSE,
  still mounted inside `createApp()` for backwards compatibility. Subscribes
  to the namespaced `LEGACY_INVOICE_CREATED` / `LEGACY_INVOICE_UPDATED`
  channels.
- **Current modular Apollo + graphql-ws schema** (`graphql/`) — served over
  WebSocket at `ws://…/graphql` via `createGraphQLServer()` in `index.ts`.
  Subscribes to `INVOICE_UPDATED` / `EVENT_STREAM` channels.

The `processor.ts` publishes each invoice event once per channel; there is no
second event bus. (Historically `src/pubsub.ts` held a second, graphql-yoga
pub-sub and `processor.ts` published to both — that duplicate was removed.)

**WebSocket subscription limits & authentication**

Subscription connections are protected against resource exhaustion and can
optionally require a shared secret:

| Setting | Env var | Default |
|---|---|---|
| Max concurrent WS connections (global) | `SUBSCRIPTION_MAX_CONNECTIONS` | `100` (`0` = unlimited) |
| Max concurrent WS connections per IP | `SUBSCRIPTION_MAX_CONNECTIONS_PER_IP` | `10` (`0` = unlimited) |
| Optional bearer token | `SUBSCRIPTION_AUTH_TOKEN` | unset = public |

When `SUBSCRIPTION_AUTH_TOKEN` is set, clients must present it as
`Authorization: Bearer <token>` in the graphql-transport-ws `connection_init`
handshake; otherwise the connection is rejected. Exceeding either connection
cap closes the new socket immediately with code `1008`.

## Data Flow

```
1. Poller fetches events from Stellar RPC
         │
         ▼
2. Processor receives each event
         │
         ▼
3. Check deduplication (has event been processed?)
         │
         ├── Yes → Skip
         │
         ▼ No
4. Store event record in SQLite
         │
         ▼
5. Fetch current invoice state from RPC
         │
         ▼
6. Upsert invoice into SQLite
         │
         ▼
7. Invalidate cache for this invoice
         │
         ▼
8. API serves requests using cached/uncached data
```

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| CONTRACT_ID | - | ILN contract address |
| NETWORK_PASSPHRASE | Test SDF Network | Stellar network passphrase |
| RPC_URL | https://soroban-testnet.stellar.org | Stellar RPC endpoint |
| DB_PATH | indexer.db | SQLite database path |
| POLL_INTERVAL_MS | 5000 | Polling interval in ms |
| PORT | 3001 | API server port |
| START_LEDGER | 0 | Starting ledger (0 = auto) |
| REDIS_URL | - | Redis URL (optional) |
| RATE_LIMIT_WINDOW_MS | 60000 | Rate limit window |
| RATE_LIMIT_MAX | 100 | Max requests per window |
| RATE_LIMIT_WHITELIST | - | Comma-separated IPs |

## Deployment

See [Deployment Guide](./deployment.md) for production deployment instructions.

## Performance Considerations

1. **Batch Processing**: Events are fetched in batches of 200 to reduce RPC calls
2. **WAL Mode**: SQLite uses Write-Ahead Logging for better concurrent read performance
3. **Caching**: API responses are cached to reduce database load
4. **Indexing**: Database indexes optimize common query patterns
5. **Rate Limiting**: Prevents abuse and ensures fair resource usage

## Monitoring

- **Health Endpoint**: `/health` provides service status
- **Logs**: Console logs for polling cycles and errors
- **Metrics**: Uptime and last sync time available via health endpoint
