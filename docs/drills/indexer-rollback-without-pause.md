# Indexer Rollback Without Contract Pause (#1316)

This drill rehearsal verifies that database rewinds, reorg divergence recoveries, and cursor catchup replay can be safely executed **without triggering emergency contract pauses (`pause()`)** on Soroban.

## Invariant Guarantees

1. **Zero-Downtime Contract Operations**: On-chain invoice funding, borrower payouts, and repayments proceed uninterrupted.
2. **Safe Cursor Rewind**: The indexer purges invalid/orphaned events, restores invoice states to the target checkpoint ledger, and adjusts the stored cursor.
3. **Forward Catchup**: The poller replays canonical chain events from the rewind target up to the live tip with zero event loss.
4. **Audit Trail**: Every rollback rehearsal generates a SHA-256 signed evidence bundle retained for 90 days.

## Verification

```bash
pnpm test:indexer-rollback
```
