# Troubleshooting Guide

This guide covers common issues and solutions for the ILN Indexer.

## Common Issues

### 1. Database Errors

#### "SQLITE_BUSY" or "database is locked"

**Cause**: Multiple processes accessing the SQLite database simultaneously.

**Solution**:
```bash
# Check for other indexer processes
ps aux | grep "node dist/index.js"

# Kill any duplicate processes
pkill -f "node dist/index.js"

# If using WAL mode, ensure proper shutdown
# Check for stale WAL files
ls -la indexer.db*
```

#### "unable to open database file"

**Cause**: Database path doesn't exist or isn't writable.

**Solution**:
```bash
# Check the DB_PATH directory
ls -la $(dirname $DB_PATH)

# Create directory if needed
mkdir -p $(dirname $DB_PATH)

# Check permissions
chmod 755 $(dirname $DB_PATH)
```

### 2. Network Issues

#### "ECONNREFUSED" or "Connection refused"

**Cause**: Cannot connect to Stellar RPC node.

**Solution**:
```bash
# Test RPC connectivity
curl -s https://soroban-testnet.stellar.org | head -1

# Check if RPC node is accessible
nc -zv soroban-testnet.stellar.org 443

# Verify RPC_URL configuration
echo $RPC_URL
```

#### "timeout" or "request timed out"

**Cause**: RPC node is slow or unresponsive.

**Solution**:
1. Increase timeout in RPC client configuration
2. Use a different RPC node
3. Check network stability
4. Reduce polling frequency

#### "UNEXPECTED_EOF" or "invalid JSON"

**Cause**: RPC node returned unexpected response.

**Solution**:
```bash
# Test RPC directly
curl -X POST https://soroban-testnet.stellar.org \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'

# Check for network issues
traceroute soroban-testnet.stellar.org
```

### 3. Contract Issues

#### "Contract not found" or "Invalid contract ID"

**Cause**: CONTRACT_ID is incorrect or contract doesn't exist on the network.

**Solution**:
```bash
# Verify contract exists
# Use Stellar CLI to check
stellar contract invoke --id $CONTRACT_ID --source-account ...

# Ensure network passphrase matches
echo $NETWORK_PASSPHRASE
```

#### "Event filter mismatch"

**Cause**: Contract events don't match expected format.

**Solution**:
1. Verify contract version matches expected event schema
2. Check contract WASM is deployed correctly
3. Review contract event definitions

### 4. Performance Issues

#### High memory usage

**Cause**: Large number of events or memory leak.

**Solution**:
```bash
# Monitor memory usage
top -p $(pgrep -f "node dist/index.js")

# Restart if needed
pm2 restart indexer
```

#### Slow sync speed

**Cause**: Network latency or RPC rate limits.

**Solution**:
1. Increase `POLL_INTERVAL_MS` to reduce RPC calls
2. Use a closer/faster RPC node
3. Check for rate limiting in RPC logs
4. Consider batch size optimization

#### API response timeouts

**Cause**: Database queries are slow.

**Solution**:
```bash
# Check database size
ls -lh indexer.db

# Optimize database
sqlite3 indexer.db "VACUUM;"

# Add missing indexes if needed
sqlite3 indexer.db ".schema invoices"
```

### 5. Caching Issues

#### Redis connection errors

**Cause**: Redis server unavailable.

**Solution**:
```bash
# Check Redis status
redis-cli ping

# Verify Redis URL
echo $REDIS_URL

# Test Redis connection
redis-cli -u $REDIS_URL ping
```

#### Stale cache data

**Cause**: Cache not invalidated properly.

**Solution**:
1. Clear Redis cache: `redis-cli FLUSHDB`
2. Restart indexer to reset in-memory cache
3. Check cache invalidation logic

### 6. Deployment Issues

#### Port already in use

**Cause**: Another process is using the configured port.

**Solution**:
```bash
# Find process using port
lsof -i :3001

# Kill the process or change PORT
export PORT=3002
```

#### Permission denied

**Cause**: Insufficient permissions to write files.

**Solution**:
```bash
# Check directory permissions
ls -la /var/data

# Fix permissions
sudo chown -R $USER:$USER /var/data
chmod 755 /var/data
```

#### Container fails to start

**Cause**: Docker configuration issues.

**Solution**:
```bash
# Check container logs
docker logs iln-indexer

# Verify environment variables
docker inspect iln-indexer | grep -A 10 "Env"

# Test container manually
docker run --rm -it iln-indexer /bin/sh
```

### 7. Reorg Handling

#### Stale data after a Stellar network reorganization

**Cause**: The indexer processed ledgers that were later invalidated by a chain reorganization.

**Symptoms**:
- Invoices with stale or contradictory statuses
- Events referencing ledger sequence numbers that no longer exist
- `cursor` table pointing to a rolled-back ledger

**Solution**:
```bash
# Check the current cursor position
sqlite3 indexer.db "SELECT * FROM cursor;"

# Check for events at suspect ledger sequences
sqlite3 indexer.db "SELECT COUNT(*) FROM events WHERE ledger_sequence > <suspect_height>;"

# If the indexer does not auto-detect the reorg, reset to a known-good ledger:
sqlite3 indexer.db "UPDATE cursor SET ledger_sequence = <safe_ledger>;"

# Restart the indexer to re-sync from the safe point
pkill -f "node dist/index.js" && npm start
```

The indexer re-processes events from the cursor position. Duplicate events are
skipped by the deduplication check, so a simple cursor reset is safe.

### 8. Railway Deployment Issues

#### Database lost after deploy

**Cause**: Railway deploys create ephemeral containers; the SQLite file is not persisted by default.

**Solution**:
```bash
# Add a Railway volume mounted at /data
railway volume add -m /data

# Set the database path to the mounted volume
railway variables set DB_PATH=/data/indexer.db

# Redeploy
railway up
```

#### Service enters restart loop

**Cause**: The health check at `/health` is failing repeatedly, exceeding `restartPolicyMaxRetries`.

**Diagnosis**:
```bash
# Check Railway logs for the health check failures
railway logs --follow

# Look for common causes:
# - Missing environment variables (CONTRACT_ID, RPC_URL)
# - SQLite database not writable
# - Port mismatch
```

**Solution**: Ensure all required environment variables are set and the
database path is writable. The health endpoint returns `{ "status": "ok" }`
when SQLite is accessible and sync is recent.

## Debugging

### Enable Verbose Logging

```bash
# Add debug logging
export DEBUG=iln-indexer:*

# Or for specific components
export DEBUG=iln-indexer:poller,iln-indexer:processor
```

### Check Health Endpoint

```bash
# Basic health check
curl http://localhost:3001/health

# Pretty print JSON
curl -s http://localhost:3001/health | jq .
```

### Monitor Database

```bash
# Check database stats
sqlite3 indexer.db "SELECT COUNT(*) FROM invoices;"
sqlite3 indexer.db "SELECT COUNT(*) FROM events;"

# Check cursor position
sqlite3 indexer.db "SELECT * FROM cursor;"

# Query recent invoices
sqlite3 indexer.db "SELECT id, status, created_at FROM invoices ORDER BY id DESC LIMIT 10;"
```

### Network Diagnostics

```bash
# Test DNS resolution
nslookup soroban-testnet.stellar.org

# Test connectivity
ping soroban-testnet.stellar.org

# Check SSL certificate
openssl s_client -connect soroban-testnet.stellar.org:443
```

## Log Analysis

### Common Log Patterns

**Successful poll cycle**:
```
[poller] Starting — polling every 5000ms for contract CD3TE3...
[poller] Polled 25 events from ledger 12345 to 12350
```

**Error during poll**:
```
[poller] Error during poll: Error: Connection timeout
```

**Event processing**:
```
[processor] Processed event 0000001234-0-0 (type: funded)
[processor] Skipped duplicate event 0000001234-0-0
```

### Log Levels

- **INFO**: Normal operation messages
- **WARN**: Potential issues
- **ERROR**: Failures requiring attention
- **DEBUG**: Detailed operation info (when enabled)

## Getting Help

If you encounter issues not covered here:

1. Check the [GitHub Issues](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues)
2. Search existing issues for similar problems
3. Create a new issue with:
   - Error message
   - Steps to reproduce
   - Environment details
   - Relevant logs
