# Indexer Recovery Time Objective (RTO) Specification (#1317)

This operational specification governs disaster recovery timing and Recovery Point Objectives (RPO) for the Indexer SQLite datastore and cursor synchronizer.

## 1. Disaster Recovery SLO Thresholds

| Metric | Target | Rationale |
|---|---|---|
| **Recovery Time Objective (RTO)** | ≤ 300 seconds (5m) | Complete cold restore & verification in under 5 minutes |
| **Recovery Point Objective (RPO)** | ≤ 100 ledgers (~8m) | Maximum historical ledger rewind boundary |
| **Database Integrity** | 100% PASS | `PRAGMA integrity_check` verification post-restore |

## 2. Automated Benchmark Execution

```bash
pnpm test:indexer-rto
```
