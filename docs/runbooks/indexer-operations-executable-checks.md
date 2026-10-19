# Indexer Operations Executable Checks Specification (#1288)

This operational specification defines executable verification commands for indexer deployment, health probes, and ledger lag budgets.

## 1. Verified Controls

1. **Health & Readiness Probe**: Validates HTTP `/health` and `/ready` contract states.
2. **Ledger Lag Budget**: Asserts indexer synchronization lag remains strictly under **10 ledgers** (~50 seconds).
3. **Backup & Replay Verification**: Confirms backup tarball integrity and idempotent re-indexing from genesis/cursor.

## 2. Verification

```bash
pnpm test:indexer-ops
```
