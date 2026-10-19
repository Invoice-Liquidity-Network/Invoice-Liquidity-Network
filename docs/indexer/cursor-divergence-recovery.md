# Indexer Cursor Divergence Operator Recovery Runbook (Issue #1269)

## Overview
This runbook details operational procedures for detecting, diagnosing, and resolving indexer cursor divergence between the ILN indexer SQLite database and Soroban on-chain ledger state.

The commands below are rehearsed against a scratch database and the recovery
primitive is pinned by `indexer/tests/runbook-recovery.test.ts`; endpoint,
metric and command names are checked by `scripts/check-indexer-ops-docs.mjs`
(see [operations-checks.md](operations-checks.md)).

## Detection Signals

There are no shipped alert rules for these signals yet; use these PromQL
expressions in your alerting stack (all metrics come from `GET /metrics`):

- **Cursor stalled** — the poller has not advanced the cursor for 5 minutes:
  `time() - iln_cursor_updated_at / 1000 > 300`
- **Cursor behind the confirmed tip** — more than 100 ledgers of lag:
  `iln_confirmed_tip_ledger - iln_last_processed_ledger > 100`
- **Rewind attempts** — something tried to move the cursor backwards outside an
  authorised rollback: `increase(iln_cursor_monotonicity_violations_total[15m]) > 0`
- **State drift** — discrepancy between on-chain contract invoice status and
  indexer database `invoices.status` (reconciliation runs hourly; see
  [../runbooks/indexer-reorg-reconciliation.md](../runbooks/indexer-reorg-reconciliation.md)).

## Diagnosis Procedure

Run these from the repository root with `DB_PATH` pointing at the indexer's
database (the same value the service uses).

1. Query current indexer cursor:
   ```bash
   pnpm --filter iln-indexer exec ts-node -e "import { getCursorLedger } from './src/db'; console.log('Cursor:', getCursorLedger());"
   ```
   Or, without shell access to the database, read it from the running service:
   ```bash
   curl -s http://localhost:3001/metrics | grep '^iln_last_processed_ledger'
   ```
2. Query latest ledger sequence from Soroban RPC:
   ```bash
   curl -s -X POST -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' \
     https://soroban-testnet.stellar.org
   ```

## Recovery Steps
### Option A: Automatic Reorg Rollback
If a chain reorganization occurred, the poller automatically detects `latestLedger < storedCursor` and executes `rollbackToLedger(latestKnownLedger)`.

### Option B: Manual Cursor Reset & Re-sync
1. Pause the indexer process:
   ```bash
   docker-compose stop indexer
   ```
2. Roll back to the known good ledger (e.g., 500 ledgers prior). This removes
   events above `TARGET_LEDGER`, reverts the invoices they touched, and rewinds
   the cursor in one transaction:
   ```bash
   pnpm --filter iln-indexer exec ts-node -e "import { rollbackToLedger, getCursorLedger } from './src/db'; console.log(rollbackToLedger(TARGET_LEDGER), 'cursor now', getCursorLedger());"
   ```
   Do **not** call `setCursorLedger(TARGET_LEDGER)` to rewind: cursor
   monotonicity (#1263) refuses it with `Cursor monotonicity violation` and
   increments `iln_cursor_monotonicity_violations_total`, and it would leave
   the events above the target in place.
3. Restart indexer and observe catch-up logs:
   ```bash
   docker-compose start indexer
   docker-compose logs -f indexer
   ```
   Expect `[config] OK …` (startup validation passed) followed by
   `[poller] Starting …`. `START_LEDGER` is ignored because a cursor is stored.
