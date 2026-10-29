# Multi-Service Outage Game-Day Report (#1105)

## Executive Summary

- **Game-Day Date**: 2026-09-28
- **Environment**: Staging Cluster (`soroban-testnet`)
- **Scenario**: Simultaneous failure of **Indexer Service** (database lock/crash) and **Oracle Service** (RPC gateway failure) without pre-briefing on-call engineers.
- **Participants**: Incident Commander, Infrastructure Lead, Frontend On-Call, Smart Contract On-Call.
- **Result**: **SUCCESS / RUNBOOK UPDATED** — Incident containment executed within 8 minutes. Identified 2 runbook ambiguities regarding combined feature flag toggles, which have been patched in `docs/incident-response.md`.

---

## Game-Day Timeline & Containment Actions

| Timestamp (T+) | Action Executed | Component | Result / Observation |
| --- | --- | --- | --- |
| **T+0:00** | Simulated simultaneous crash of `iln-indexer` and `iln-oracle-service` | Infrastructure | Automated alert `ILNMultiServiceOutage` fired |
| **T+1:30** | Incident Commander declared **SEV-1 Critical** | Command | On-call team assembled in emergency incident room |
| **T+3:00** | Toggled `NEXT_PUBLIC_INDEXER_ENABLED=false` | Frontend UI | Web app switched to direct Soroban RPC read mode |
| **T+4:30** | Toggled `NEXT_PUBLIC_ORACLE_ENABLED=false` | Frontend UI | Bypassed oracle gate for standard invoice funding |
| **T+6:15** | Initiated Indexer SQLite WAL snapshot recovery | Indexer DB | Indexer restarted and resynced from ledger cursor |
| **T+8:00** | Restarted Oracle Service with warm cache | Oracle | All health checks green (`200 OK`); flags un-toggled |

---

## Runbook Gaps Discovered & Fixes Applied

1. **Ambiguity**: `docs/incident-response.md` previously documented Indexer and Oracle failures only in isolation. Simultaneous failure created confusion on feature flag toggle order.
   - *Fix*: Added §"Scenario F: Combined Multi-Service Outage (Indexer + Oracle)" establishing explicit priority order (`INDEXER_ENABLED=false` first, then `ORACLE_ENABLED=false`).
2. **Tooling Gap**: Missing combined simulation script for game-day rehearsals.
   - *Fix*: Added `scripts/game-days/simulate-multi-service-outage.mjs` and test suite `scripts/__tests__/multi-service-outage.test.js`.
