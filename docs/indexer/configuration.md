# Configuration

The ILN Indexer is configured via environment variables. This document describes all available configuration options.

## Environment Variables

### Required

| Variable | Type | Description |
|----------|------|-------------|
| `CONTRACT_ID` | string | The ILN contract address on Stellar |

### Network

| Variable | Default | Description |
|----------|---------|-------------|
| `NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | Stellar network passphrase |
| `RPC_URL` | `https://soroban-testnet.stellar.org` | Stellar RPC node URL |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PATH` | `indexer.db` | Path to SQLite database file |

### Polling

| Variable | Default | Description |
|----------|---------|-------------|
| `POLL_INTERVAL_MS` | `5000` | Polling interval in milliseconds |
| `START_LEDGER` | `0` | Starting ledger sequence (0 = auto-detect) |

### API Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP port for the REST API |

### Caching

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | - | Redis connection URL (optional) |

### Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window in milliseconds |
| `RATE_LIMIT_MAX` | `100` | Maximum requests per IP per window |
| `RATE_LIMIT_WHITELIST` | - | Comma-separated list of exact client IP addresses to exempt; values are never usernames, API keys, or arbitrary identifiers |

### Rate-limit whitelist threat model

`RATE_LIMIT_WHITELIST` is an operational exception for trusted infrastructure such as a private monitoring agent. Entries are exact normalized IP addresses (IPv4, IPv6, or IPv4-mapped IPv6); they are not authentication credentials. The service must therefore run behind a correctly configured trusted proxy, and the proxy must overwrite—not append to—forwarded client-IP headers. Do not whitelist public users, shared NAT addresses, or values supplied by clients. An attacker who can reach the service from a whitelisted network can bypass the limiter, so network access control and authenticated infrastructure identity remain mandatory.

The limiter rejects non-IP whitelist values and compares only the parsed `req.ip`, preventing spoofed arbitrary identifiers from matching an entry.

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
CONTRACT_ID=YOUR_MAINNET_CONTRACT_ID
NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
RPC_URL=https://soroban-mainnet.stellar.org
DB_PATH=/data/indexer.db
PORT=3001
POLL_INTERVAL_MS=3000
RATE_LIMIT_MAX=50
RATE_LIMIT_WHITELIST=10.0.0.1,10.0.0.2
REDIS_URL=redis://localhost:6379
```

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
- Special value `:memory:` for in-memory database (testing only)

### POLL_INTERVAL_MS

How often to poll for new events, in milliseconds. Consider:
- **Lower values** (1000-3000ms): Faster sync, higher RPC usage
- **Higher values** (5000-10000ms): Slower sync, lower RPC usage
- **Recommended**: 5000ms for most use cases

### START_LEDGER

The ledger sequence to start indexing from on first run:

- `0`: Auto-detect (starts ~1000 ledgers before latest)
- Positive number: Start from that specific ledger

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

## Validation

The indexer validates configuration on startup:
- `CONTRACT_ID` must be a valid Stellar address
- `PORT` must be a valid port number
- `POLL_INTERVAL_MS` must be positive
- `DB_PATH` must be writable

Invalid configuration will cause the process to exit with an error message.

## Runtime Configuration

Some settings can be changed at runtime:
- Rate limiting rules (via API)
- Cache TTL (requires restart)
- Polling interval (requires restart)

Database and network settings require a restart to change.
