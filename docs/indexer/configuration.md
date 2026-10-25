# Configuration

The ILN Indexer is configured via environment variables. This document describes all available configuration options.

> **This page is machine-checked.** `node scripts/check-indexer-ops-docs.mjs`
> fails CI when a variable the indexer reads is missing from the tables below,
> when a table lists a variable no code reads, or when a documented default
> differs from the code. See [operations-checks.md](operations-checks.md).

## Environment Variables

### Contract and network

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTRACT_ID` | `CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC` | ILN contract address (`C…`) whose events are indexed. **Required when `NODE_ENV=production`**; the testnet default is for local development only |
| `NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | Stellar network passphrase |
| `RPC_URL` | `https://soroban-testnet.stellar.org` | Stellar RPC node URL |
| `NODE_ENV` | - | `production` enables the production startup rules below and disables GraphiQL |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PATH` | `indexer.db` | Path to SQLite database file |
| `ANALYTICS_DB_PATH` | - | Optional read-only SQLite replica used for heavy analytics queries |
| `ANALYTICS_QUERY_BUDGET_MS` | `5000` | Analytics queries slower than this are counted in `iln_analytics_query_exceeded_budget_total` |

### Polling

| Variable | Default | Description |
|----------|---------|-------------|
| `POLL_INTERVAL_MS` | `5000` | Polling interval in milliseconds (100 – 3,600,000) |
| `START_LEDGER` | `0` | Starting ledger sequence for an **empty** database (0 = auto-detect) |
| `CONFIRMATION_DEPTH` | `10` | Ledgers an event must be behind the tip before it is indexed (0 – 1000) |

### API Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP port for the REST API |

### Caching

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | - | Redis connection URL (optional, `redis://` or `rediss://`) |

### Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window in milliseconds |
| `RATE_LIMIT_MAX` | `100` | Maximum requests per IP per window |
| `RATE_LIMIT_WHITELIST` | - | Comma-separated list of exact client IP addresses to exempt; values are never usernames, API keys, or arbitrary identifiers |

### Rate-limit whitelist threat model

`RATE_LIMIT_WHITELIST` is an operational exception for trusted infrastructure such as a private monitoring agent. Entries are exact normalized IP addresses (IPv4, IPv6, or IPv4-mapped IPv6); they are not authentication credentials. The service must therefore run behind a correctly configured trusted proxy, and the proxy must overwrite—not append to—forwarded client-IP headers. Do not whitelist public users, shared NAT addresses, or values supplied by clients. An attacker who can reach the service from a whitelisted network can bypass the limiter, so network access control and authenticated infrastructure identity remain mandatory.

The indexer refuses to start if any whitelist entry is not an IP address, and the limiter compares only the parsed `req.ip`, so spoofed arbitrary identifiers cannot match an entry. `/health` and `/v1/health` are never rate limited, so orchestrator health probes cannot be throttled.

### GraphQL query limits

GraphQL requests are rejected before resolver execution when their calculated
selection complexity exceeds 50 or their selection depth exceeds 2. These
limits match the current schema's shallow, read-only query shape; clients
should use pagination rather than large aliases or deeply nested selections.

### GraphQL Subscriptions

| Variable | Default | Description |
|----------|---------|-------------|
| `SUBSCRIPTION_AUTH_TOKEN` | - | Optional bearer token required on WebSocket subscription connections (unset = public) |
| `SUBSCRIPTION_MAX_CONNECTIONS` | `100` | Max concurrent WebSocket connections (`0` = unlimited) |
| `SUBSCRIPTION_MAX_CONNECTIONS_PER_IP` | `10` | Max concurrent WebSocket connections per client IP (`0` = unlimited) |

### Archival

See [backup-archive.md](backup-archive.md) for the retention policy.

| Variable | Default | Description |
|----------|---------|-------------|
| `ARCHIVE_ENABLED` | `true` | Run the archival scheduler. Exactly `true` or `false` |
| `ARCHIVE_INTERVAL_MS` | `86400000` | How often archival runs (minimum 60,000) |
| `ARCHIVE_OLDER_THAN_DAYS` | `90` | Records older than this move to the archive database |
| `ARCHIVE_PURGE_OLDER_THAN_DAYS` | `2555` | Archived records older than this are deleted; must be ≥ `ARCHIVE_OLDER_THAN_DAYS` |
| `ARCHIVE_DB_PATH` | `archive.db` | SQLite file attached as the `archive` schema |

### Backups

See [backup-archive.md](backup-archive.md) and the
[backup/restore drill](../drills/README-indexer-drill.md).

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKUP_ENABLED` | `false` | Run automated backups. Exactly `true` or `false` |
| `BACKUP_INTERVAL_MS` | `86400000` | Backup interval (minimum 60,000) |
| `BACKUP_DIR` | `./backups` | Local backup directory |
| `BACKUP_MAX_LOCAL` | `30` | Local backups to keep |
| `BACKUP_CLOUD_PROVIDER` | - | `s3`, `gcs` or `azure`; requires `BACKUP_CLOUD_BUCKET` |
| `BACKUP_CLOUD_BUCKET` | - | Bucket for off-volume copies |
| `BACKUP_CLOUD_PREFIX` | - | Optional key prefix within the bucket |
| `BACKUP_CLOUD_REGION` | - | Bucket region |

### Exports

Limits for `GET /export/*` and async export jobs; see
[api-reference.md](api-reference.md#bulk-exports-streaming) for behaviour when exceeded.

| Variable | Default | Description |
|----------|---------|-------------|
| `EXPORT_SESSION_MAX_ROWS` | `200_000` | Rows per export session, across pages |
| `EXPORT_SESSION_MAX_SECONDS` | `300` | Wall-clock budget per streamed response |
| `EXPORT_SESSION_MAX_BYTES` | `100_000_000` | Bytes per streamed response |
| `EXPORT_PAGE_MAX_ROWS` | `5000` | Rows per streamed page |
| `EXPORT_JOB_TTL_SECONDS` | `1800` | How long finished jobs are kept |
| `EXPORT_JOB_MAX` | `1000` | Jobs tracked in memory |

## Configuration Examples

### Basic Testnet Setup

```env
CONTRACT_ID=CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC
NETWORK_PASSPHRASE=Test SDF Network ; September 2015
RPC_URL=https://soroban-testnet.stellar.org
DB_PATH=indexer.db
PORT=3001
```

### Production Mainnet Setup

```env
NODE_ENV=production
CONTRACT_ID=YOUR_MAINNET_CONTRACT_ID
NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
RPC_URL=https://soroban-mainnet.stellar.org
DB_PATH=/data/indexer.db
PORT=3001
POLL_INTERVAL_MS=3000
RATE_LIMIT_MAX=50
RATE_LIMIT_WHITELIST=10.0.0.1,10.0.0.2
REDIS_URL=redis://localhost:6379
BACKUP_ENABLED=true
BACKUP_CLOUD_PROVIDER=s3
BACKUP_CLOUD_BUCKET=iln-indexer-backups
```

`YOUR_MAINNET_CONTRACT_ID` is a placeholder: the indexer refuses to start
until it is replaced with a real contract address.

### Development Setup

```env
CONTRACT_ID=CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC
NETWORK_PASSPHRASE=Test SDF Network ; September 2015
RPC_URL=https://soroban-testnet.stellar.org
DB_PATH=indexer-dev.db
PORT=3001
POLL_INTERVAL_MS=10000
RATE_LIMIT_MAX=1000
```

## Detailed Descriptions

### CONTRACT_ID

The Stellar contract address for the ILN contract. This is the contract whose events will be indexed.

```env
CONTRACT_ID=CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC
```

### NETWORK_PASSPHRASE

The Stellar network passphrase for the target network:

- **Testnet**: `Test SDF Network ; September 2015`
- **Mainnet**: `Public Global Stellar Network ; September 2015`
- **Standalone**: `Standalone Network ; February 2017`

### RPC_URL

URL of the Stellar RPC node to poll for events. Ensure the node has:
- Event subscription support
- Contract WASM access
- Adequate rate limits for your polling frequency

### DB_PATH

Path to the SQLite database file. Can be:
- Relative path (e.g., `indexer.db`)
- Absolute path (e.g., `/var/data/indexer.db`)
- Special value `:memory:` for in-memory database (testing only — refused when `NODE_ENV=production`)

### POLL_INTERVAL_MS

How often to poll for new events, in milliseconds. Consider:
- **Lower values** (1000-3000ms): Faster sync, higher RPC usage
- **Higher values** (5000-10000ms): Slower sync, lower RPC usage
- **Recommended**: 5000ms for most use cases

Values below 100 ms are refused: a typo such as `5s` used to become `NaN`,
which Node treats as a ~1 ms timer and turns into a tight loop against the RPC node.

### START_LEDGER

The ledger sequence to start indexing from on first run:

- `0`: Auto-detect (starts 1000 ledgers before latest, never below ledger 1)
- Positive number: Start from that specific ledger

`START_LEDGER` only applies to an empty database. Once a cursor is stored, a
restart resumes from (and re-scans) the stored cursor and logs
`[poller] START_LEDGER=… ignored: resuming from stored cursor …`. To replay
history, reset the cursor as described in
[cursor-divergence-recovery.md](cursor-divergence-recovery.md).

Setting this too high may cause the indexer to miss historical events.

### PORT

The HTTP port for the REST API server. Ensure the port is:
- Not already in use
- Accessible through firewalls
- Behind a reverse proxy for production

### REDIS_URL

Optional Redis connection for distributed caching:

```env
# Local Redis
REDIS_URL=redis://localhost:6379

# Redis with password
REDIS_URL=redis://:password@localhost:6379

# Remote Redis
REDIS_URL=redis://redis.example.com:6379
```

When not set, in-memory caching is used.

### Rate Limiting Variables

Rate limiting protects the API from abuse:

```env
# Window: 60 seconds
RATE_LIMIT_WINDOW_MS=60000

# Max: 100 requests per window per IP
RATE_LIMIT_MAX=100

# Exempt internal IPs
RATE_LIMIT_WHITELIST=10.0.0.1,10.0.0.2
```

### GraphQL Subscription Variables

The GraphQL WebSocket transport can be rate-limited per connection and
optionally authenticated:

```env
# Require clients to present this token as `Authorization: Bearer <token>`
# in the connection_init handshake. When unset, subscriptions are public.
SUBSCRIPTION_AUTH_TOKEN=change-me

# At most 100 concurrent WebSocket connections total.
SUBSCRIPTION_MAX_CONNECTIONS=100

# At most 10 concurrent WebSocket connections per client IP.
SUBSCRIPTION_MAX_CONNECTIONS_PER_IP=10
```

Connections beyond the global or per-IP cap are closed immediately with code
`1008` (`Too many connections`). This prevents a single client from
exhausting sockets or event-bus subscriptions.

## Startup validation

Before the indexer opens its port, polls the RPC node or opens the database,
`indexer/src/configValidation.ts` checks the raw environment. Every problem is
logged at once as `[config] INVALID <VARIABLE> <reason>` and the Node process
exits with code **78** (`EX_CONFIG`; under `pnpm start` pnpm reports
`exit code 78` and exits 1). A valid configuration logs one secret-free
`[config] OK …` line and exports `iln_indexer_config_info`. See
[operations-checks.md](operations-checks.md) for the runbook.

**Errors (refuse to start)**

- Any numeric variable that is not a plain whole number (`5s`, `5e3`, `1.5`,
  `-1`), is set but empty, or is outside its range:

  | Variable | Range |
  |---|---|
  | `PORT` | 1 – 65535 |
  | `POLL_INTERVAL_MS` | 100 – 3,600,000 |
  | `START_LEDGER` | ≥ 0 |
  | `CONFIRMATION_DEPTH` | 0 – 1000 |
  | `RATE_LIMIT_WINDOW_MS` | ≥ 1000 |
  | `RATE_LIMIT_MAX` | ≥ 1 |
  | `SUBSCRIPTION_MAX_CONNECTIONS`, `SUBSCRIPTION_MAX_CONNECTIONS_PER_IP` | ≥ 0 |
  | `ARCHIVE_INTERVAL_MS`, `BACKUP_INTERVAL_MS` | ≥ 60,000 |
  | `ARCHIVE_OLDER_THAN_DAYS`, `ARCHIVE_PURGE_OLDER_THAN_DAYS` | ≥ 1, purge ≥ archive |
  | `BACKUP_MAX_LOCAL`, `ANALYTICS_QUERY_BUDGET_MS`, all `EXPORT_*` | ≥ 1 |

- `CONTRACT_ID` missing when `NODE_ENV=production`, or not a valid `C…` contract address (checksum included).
- `NETWORK_PASSPHRASE` set but empty; `RPC_URL` not an absolute `http(s)` URL.
- A mainnet passphrase with a testnet/futurenet RPC host, or the reverse.
- `DB_PATH` empty, its directory missing or not writable, or `:memory:` in production.
- `ARCHIVE_ENABLED` / `BACKUP_ENABLED` set to anything other than exactly `true` or `false`
  (the code compares literally, so `False` would *enable* archival and `TRUE` would *disable* backups).
- `BACKUP_CLOUD_PROVIDER` not one of `s3`, `gcs`, `azure`, or set without `BACKUP_CLOUD_BUCKET`.
- A `RATE_LIMIT_WHITELIST` entry that is not an IP address.
- `REDIS_URL` that is not a `redis://` or `rediss://` URL.

**Warnings (start, logged as `[config] WARN …`, counted in `iln_indexer_config_warnings`)**

- `CONTRACT_ID` unset outside production (the testnet default is used).
- An unrecognised `NETWORK_PASSPHRASE`.
- Plain `http` RPC to a public host in production.
- `BACKUP_ENABLED` not `true` in production.
- `BACKUP_CLOUD_BUCKET` without a provider; `SUBSCRIPTION_AUTH_TOKEN` shorter than 16 characters.

## Runtime Configuration

Configuration is read once at startup. Every change — rate limits, polling
interval, cache, database and network settings — requires a restart, and the
restart re-runs startup validation.
