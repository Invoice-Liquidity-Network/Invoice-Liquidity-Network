# Deployment Guide

This guide covers deploying the ILN Indexer in various environments.

## Prerequisites

- Node.js 20+
- npm or yarn
- SQLite (bundled with better-sqlite3)
- Stellar RPC node access

## Local Development

```bash
# Clone the repository
git clone https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network.git
cd Invoice-Liquidity-Network

# Install dependencies
npm install

# Navigate to indexer
cd indexer

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# At minimum, set CONTRACT_ID and RPC_URL

# Start in development mode (with hot reload)
npm run dev
```

## Production Deployment

### Option 1: Direct Node.js

```bash
# Build the project
npm run build

# Start the server
npm start
```

### Option 2: Docker

Create a `Dockerfile` in the indexer directory:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy built files
COPY dist/ ./dist/

# Copy database path
RUN mkdir -p /data

# Set environment variables
ENV DB_PATH=/data/indexer.db
ENV PORT=3001

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -f http://localhost:3001/health || exit 1

# Start the server
CMD ["node", "dist/index.js"]
```

Build and run:

```bash
# Build the Docker image
docker build -t iln-indexer .

# Run the container
docker run -d \
  --name iln-indexer \
  -p 3001:3001 \
  -v indexer-data:/data \
  -e CONTRACT_ID=YOUR_CONTRACT_ID \
  -e RPC_URL=YOUR_RPC_URL \
  -e NETWORK_PASSPHRASE="Test SDF Network ; September 2015" \
  iln-indexer
```

### Option 3: Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  indexer:
    build: .
    ports:
      - "3001:3001"
    volumes:
      - indexer-data:/data
    environment:
      - CONTRACT_ID=${CONTRACT_ID}
      - RPC_URL=${RPC_URL}
      - NETWORK_PASSPHRASE=${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped

volumes:
  indexer-data:
  redis-data:
```

Run:

```bash
# Create .env file
cat > .env << EOF
CONTRACT_ID=your_contract_id
RPC_URL=https://soroban-testnet.stellar.org
NETWORK_PASSPHRASE=Test SDF Network ; September 2015
EOF

# Start services
docker-compose up -d
```

### Option 4: Railway

The project includes `railway.toml` for Railway deployment:

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to project
railway link

# Set environment variables
railway variables set CONTRACT_ID=your_contract_id
railway variables set RPC_URL=https://soroban-testnet.stellar.org
railway variables set REDIS_URL=redis://your-redis:6379

# Deploy
railway up
```

#### Railway Production Configuration

The `railway.toml` is pre-configured for production workloads:

| Setting | Value | Rationale |
|---------|-------|-----------|
| `restartPolicyMaxRetries` | 5 | Allows recovery from transient failures before marking the service as failed |
| `restartPolicyMaxDelay` | 60 | Caps exponential backoff at 60 seconds between restarts |
| `healthcheckPath` | `/health` | Checks both SQLite connectivity and sync freshness |
| `healthcheckTimeout` | 10 seconds | Fails fast enough for Railway to trigger a restart |
| `numReplicas` | 1 | Enforces single-instance deployment — SQLite single-writer constraint prevents horizontal scaling |

##### Health Check Behavior

The `/health` endpoint returns:
- `status: "ok"` — SQLite is accessible and the service is operational.
- `status: "degraded"` — SQLite connectivity failed but the process is running.

Railway marks the deployment as failed when the health check returns a non-2xx
response or times out (configured at 10 seconds). A `degraded` status still
returns 200 so Railway does not restart the service for transient DB issues —
but monitoring should alert on it.

##### Volume Mounting

**Important**: Railway deployments are ephemeral — the SQLite database is lost on each deploy.
For production use, mount a Railway Volume at the database path:

```bash
railway volume add -m /data
railway variables set DB_PATH=/data/indexer.db
```

Without a volume, every deploy starts a fresh database and re-indexes from the configured `START_LEDGER`.

##### Production Checklist

Before deploying to production, ensure the following environment variables are set:

```bash
# Required
railway variables set CONTRACT_ID=<your_contract_id>
railway variables set RPC_URL=<your_rpc_url>
railway variables set NETWORK_PASSPHRASE="Test SDF Network ; September 2015"  # or mainnet passphrase

# Recommended for production
railway variables set DB_PATH=/data/indexer.db
railway variables set REDIS_URL=<your_redis_url>

# Optional tuning
railway variables set POLL_INTERVAL_MS=5000
railway variables set RATE_LIMIT_WINDOW_MS=60000
railway variables set RATE_LIMIT_MAX=100
```

##### Scaling Considerations

The indexer is **designed for single-instance deployment only** due to:
1. **SQLite single-writer constraint** — concurrent writes cause `SQLITE_BUSY`.
2. **Cursor management** — multiple instances would race on the sync cursor.
3. **Event deduplication** — the dedup layer is in-process, not shared.

For high-traffic scenarios, use Redis for caching and consider read replicas for API queries.

## Environment Variables

See [Configuration](./configuration.md) for complete environment variable reference.

## Production Considerations

### Database

1. **Backup Strategy**: Regularly backup the SQLite database
2. **Storage**: Use persistent storage (volume mount or managed disk)
3. **Location**: Keep database on fast storage (SSD preferred)

### Networking

1. **RPC Access**: Ensure reliable access to Stellar RPC nodes
2. **Rate Limits**: Be aware of RPC rate limits
3. **Fallback**: Consider multiple RPC endpoints for redundancy

### Monitoring

1. **Health Checks**: Monitor `/health` endpoint
2. **Logs**: Aggregate logs for analysis
3. **Alerts**: Set up alerts for:
   - Service downtime
   - High error rates
   - Database issues
   - Sync delays

### Scaling

The indexer is designed for single-instance deployment due to:
- SQLite single-writer constraint
- Cursor management
- Event deduplication

For high-traffic scenarios:
1. Use Redis for caching
2. Consider read replicas for API queries
3. Monitor database size and prune old events

## Updating

```bash
# Pull latest changes
git pull

# Rebuild
npm run build

# Restart the service
# For direct Node.js:
pkill -f "node dist/index.js"
npm start

# For Docker:
docker-compose down
docker-compose up -d --build

# For Railway:
railway up
```

## Troubleshooting

See [Troubleshooting Guide](./troubleshooting.md) for common issues and solutions.
