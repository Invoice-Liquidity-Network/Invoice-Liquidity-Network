- closes #1040
- closes #1039
- closes #1036
- closes #1034

## Summary of Changes
- **Indexer Backfill Checkpointing (#1040)**: Added logic to `indexer/src/poller.ts` to save the processed cursor mid-batch during the `do...while` pagination loop, preventing large backfills from having to restart from the beginning in case of a crash or interruption.
- **Chain-Reorg Detection and Rollback (#1039)**: Implemented `rollbackToLedger` in `indexer/src/db.ts` to safely delete orphaned events and update the cursor backwards. Integrated detection logic in `indexer/src/poller.ts` that triggers the rollback if the `latestKnownLedger` retrieved from the RPC falls behind the `stored` cursor.
- **Offline/Degraded Network Queue (#1036)**: Updated the main write methods in the SDK (`submitInvoice`, `fundInvoice`, `markPaid`, `claimDefault` in `sdk/src/client.ts`) to catch `NetworkError`, `TimeoutError`, and `fetch failed` exceptions. When caught (if the offline manager is enabled), the operations are queued automatically to be retried when the network/RPC connectivity is restored.
- **Bundle-Size Regression Enforcement (#1034)**: Modified `sdk/package.json` to include a post-build step that runs `node ../scripts/check-bundle-size.js` automatically after `tsup` finishes building, strictly enforcing the bundle size budgets defined in `sdk/.bundle-size.json`.
