# Indexer Troubleshooting

Use the checks below against the running indexer before changing its state.
Production logs and resource graphs are available from the Railway service;
local commands assume they are run from the `indexer` directory.

## Health check and database errors

Railway probes `/v1/health`; local monitoring can use that endpoint or the
backward-compatible `/health` route. A healthy response is
`200` JSON with `status: "ok"`, `db: "ok"`, `lastSync`, and `uptime`. A failed
SQLite query returns `503` with `status: "error"` and `db: "error"`.
`/v1/health` returns the same health state. These paths bypass API rate
limiting.

```bash
curl -i http://localhost:3001/health
curl -i http://localhost:3001/v1/health
```

If the endpoint reports a database error, check the configured path and its
parent directory before restarting:

```bash
echo "$DB_PATH"
ls -ld "$(dirname "$DB_PATH")"
ls -l "$DB_PATH"*
```

Create the parent directory and grant the service user write access if it is
missing or not writable. SQLite `SQLITE_BUSY` usually indicates another writer:
run only one indexer process against a database, and keep Railway at one replica.
Do not delete `-wal` or `-shm` files while the process is running.

Database diagnostics:

```bash
sqlite3 "$DB_PATH" "PRAGMA quick_check;"
sqlite3 "$DB_PATH" "SELECT last_ledger, updated_at FROM cursor WHERE id = 1;"
sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM invoices;"
sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM events;"
```

Run `VACUUM` only during a planned maintenance window with the indexer stopped
and a verified backup available; it is not a live-query fix.

## Stellar RPC connection and response errors

The configured `RPC_URL` is used by the poller. Confirm its value and call the
RPC health method directly:

```bash
echo "$RPC_URL"
curl -i -X POST "$RPC_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```

For `ECONNREFUSED`, timeouts, or invalid JSON, check DNS/TLS and the provider's
status, then verify that the configured URL is the provider's JSON-RPC endpoint.
Use a supported replacement RPC URL if needed. The poller logs failed polling
cycles and schedules another cycle; it does not stop permanently on an RPC
failure.

## Contract ID, event format, and slow synchronization

Check `CONTRACT_ID`, `NETWORK_PASSPHRASE`, and `RPC_URL` together. A contract
deployed on a different Stellar network will not be found when the RPC URL and
network passphrase point elsewhere. The sample environment defaults to testnet;
set all three values explicitly for production.

The poller fetches events in batches of 200 and uses `POLL_INTERVAL_MS`
(default 5000 ms). A slow sync can be caused by a slow or rate-limited RPC
provider, a large backlog, or slow SQLite writes. Check the poller logs, the
database cursor query above, Railway CPU/memory graphs, and RPC-provider
rate-limit information before changing the polling interval. Increasing the
interval reduces calls but can increase catch-up time.

### Ledger reorganization and replay

Each poll starts again from the saved cursor ledger, intentionally overlapping
the last processed ledger. Duplicate event IDs are ignored by the processor,
so the overlap is safe and protects against missing boundary events after a
restart. The current indexer does **not** roll back database rows for events
removed by a chain reorganization; overlap and deduplication are not a full
canonical-chain rollback mechanism.

If an orphaned event is confirmed, take a verified database backup, stop the
indexer, and rebuild into a new database from a known-good ledger using a new
`DB_PATH` and `START_LEDGER`. Validate the new database and sync cursor before
switching traffic back. Do not lower only the existing cursor: already stored
event IDs and invoice state would remain and can mask a correct replay.

## API latency or high resource use

Check Railway's service CPU and memory graphs, the `DB_PATH` file size, and
the database counts/cursor above. The code uses SQLite and is intended to run
as one poller/API process; adding replicas is not a horizontal-scaling fix.
If API latency rises with database size, identify the slow request and query
before scheduling offline database maintenance. Size Railway CPU and memory
from the indexer load-test reports and confirm the selected resource plan with
a repeat test; resource limits are not configured in `railway.toml`.

## Railway startup, port, and restart failures

Railway starts the `web` process from `Procfile` (`node dist/index.js`), with
`PORT` supplied by the platform. The committed `railway.toml` invokes the
`iln-indexer` workspace `start` script, which runs the same command. Check the
Railway deployment/build logs for startup errors and verify `PORT`, `DB_PATH`,
`CONTRACT_ID`, and `RPC_URL`.
Ensure `/data` is a persistent volume and `DB_PATH=/data/indexer.db` for
production so a restart does not discard SQLite state.

The service restarts on process failure with a bounded retry count. A health
check failure is not a substitute for fixing the reported startup or database
error; use the `/health` response and deployment logs to diagnose it.

## Logging

The poller and processor write component-prefixed messages to standard output
and standard error (for example, `[poller] Error during poll`). Use the
platform's log viewer or the foreground `npm start` output. The service does
not currently use a `DEBUG=iln-indexer:*` switch or PM2-managed process, so
those settings/commands do not enable additional logging here.

## Verification coverage

The operational behaviors above are covered by the health/API and rate-limit
tests in `indexer/tests/api.test.ts` and `indexer/tests/rateLimit.test.ts`,
event ingestion and deduplication tests in `indexer/tests/ingestion.test.ts`,
and poller overlap tests in `indexer/tests/poller.test.ts`. Provider reachability,
Railway plan capacity, filesystem permissions on the deployed volume, and
external RPC-provider incidents must still be checked in the target environment;
unit tests cannot establish those remote conditions.
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
pkill -f "node dist/index.js" && npm start
```

#### Slow sync speed

**Cause**: Network latency or RPC rate limits.

**Solution**:
1. Increase `POLL_INTERVAL_MS` to reduce RPC calls
2. Use a closer/faster RPC node
3. Check for rate limiting in RPC logs
4. Consider batch size optimization

#### Indexer falls behind (sync lag)

**Cause**: The poller is processing events slower than new ledgers are closed. Common causes: slow RPC responses, large event batches, or high `POLL_INTERVAL_MS`.

**Symptoms**:
- `lastSync` timestamp from `/health` is more than a few minutes old
- New invoices submitted on-chain are not appearing in the API
- Poller logs show repeated long poll cycles

**Solution**:
```bash
# Check current cursor position vs latest ledger
sqlite3 indexer.db "SELECT * FROM cursor;"

# Reduce poll interval (default 5000ms)
railway variables set POLL_INTERVAL_MS=3000

# Check RPC latency
curl -s -o /dev/null -w "%{time_total}\n" -X POST $RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'

# If sync lag persists, consider reducing batch size in poller.ts (BATCH_SIZE)
```

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

#### Stale data after a crash or mid-batch failure

**Cause**: The indexer crashed or was killed while processing events, leaving the cursor
at a ledger that was only partially processed. Note: **Stellar has no chain
reorganizations** — this section covers crash recovery, not true reorgs.

**Symptoms**:
- Invoices with stale or contradictory statuses
- Events referencing ledger sequence numbers that no longer exist
- `cursor` table pointing to a partially-processed ledger

**Solution**:
```bash
# Check the current cursor position
sqlite3 indexer.db "SELECT * FROM cursor;"

# Check for events at suspect ledger sequences
sqlite3 indexer.db "SELECT COUNT(*) FROM events WHERE ledger_sequence > <suspect_height>;"

# If the indexer does not auto-recover, reset to a known-good ledger:
sqlite3 indexer.db "UPDATE cursor SET ledger_sequence = <safe_ledger>;"

# Restart the indexer to re-sync from the safe point
pkill -f "node dist/index.js" && npm start
```

The indexer re-processes events from the cursor position. Duplicate events are
skipped by the deduplication check, so a simple cursor reset is safe.

**How the indexer prevents this**: The poller re-scans the last processed ledger
on every cycle (`startLedger = stored` in `poller.ts`), giving a natural overlap
window. Combined with the deduplication check in `processor.ts`, this makes the
indexer resilient to most crash scenarios without manual intervention.

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
# - Health endpoint returning "degraded" (DB unreachable)
```

**Solution**: Ensure all required environment variables are set and the
database path is writable. The health endpoint returns `{ "status": "ok" }`
when SQLite is accessible and `{ "status": "degraded" }` when the DB check fails.

#### Health check returns degraded

**Cause**: The SQLite database is not accessible or corrupted, but the Node.js
process is still running.

**Diagnosis**:
```bash
# Check health endpoint
curl http://localhost:3001/health

# If status is "degraded", check the database file
ls -la $DB_PATH

# Verify the directory is writable
touch $DB_PATH.test && rm $DB_PATH.test
```

**Solution**:
1. Ensure the volume mount exists and `DB_PATH` points to it
2. Check for disk space: `df -h /data`
3. If the database is corrupted, remove it and let the indexer re-sync:
   ```bash
   rm $DB_PATH
   railway up  # triggers a fresh deploy with re-indexing
   ```

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
