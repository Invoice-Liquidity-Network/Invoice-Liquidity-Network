# Automated Data-Loss & Integrity Detection Coverage (#1108)

## Overview

This document specifies the automated detection signals deployed to catch potential data loss, event skips, or state corruption risk, derived directly from past near-miss incident history in the Invoice Liquidity Network.

---

## Provenance Matrix & Detection Rules

| Signal ID | Incident Provenance | Detection Signal | Category | Threshold & Rule | Action & Alert Target |
| --- | --- | --- | --- | --- | --- |
| `SIG-DL-001` | **NM-2026-02** (Indexer Event Lag) | Ledger sequence gap between Soroban RPC head and Indexer state | `block-gap` | `ledger_head - indexer_ledger > 50` ledgers (>2m lag) | `ILNIndexerLedgerSequenceGapDetected` (P2 Alert → Ops) |
| `SIG-DL-002` | **NM-2026-04** (Storage State Mismatch) | State snapshot root hash mismatch between on-chain storage and DB | `state-drift` | `onchain_hash != db_hash` | `ILNStateSnapshotMismatchDetected` (P1 Alert → DB Team) |
| `SIG-DL-003` | **NM-2026-05** (Stale Payload Verification) | Corrupted payload structure, signature failure, or timestamp drift | `payload-corruption` | Age > 60s or signature invalid | `ILNOraclePayloadDataCorruption` (P1 Alert → Ops) |
| `SIG-DL-004` | **NM-2026-06** (Event Queue Backpressure Drop) | Discrepancy between contract emitted events and indexer DB entries | `unindexed-event` | `emitted_events - persisted_events > 0` | `ILNUnindexedContractEventDropRate` (P3 Warning) |

---

## Execution & Monitoring Integration

- **Alerting Pipeline**: Wired directly into `monitoring/prometheus/data-loss-alerts.yml`.
- **Automated Detector Script**: Executable via `node scripts/detect-data-loss.mjs`.
- **Test Verification**: Covered in `scripts/__tests__/data-loss-detection.test.js`.
