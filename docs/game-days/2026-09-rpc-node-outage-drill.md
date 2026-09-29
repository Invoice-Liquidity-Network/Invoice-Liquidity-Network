# RPC-Node Outage System Drill Report (#1107)

## Executive Summary

- **Drill Date**: 2026-09-28
- **Environment**: Staging Cluster (`soroban-testnet`)
- **Objective**: Validate protocol behavior, SDK multi-endpoint failover, indexer retry backoff, and oracle-service degraded state recovery under a total primary Soroban RPC provider blackout.
- **Participants**: Protocol Infra Lead, SDK Maintainer, On-Call Lead.
- **Result**: **PASS** — SDK multi-endpoint failover automatically switched to secondary endpoint within 420ms; Indexer entered exponential backoff without dropping state; Oracle-service switched to cached read-mode and degraded gracefully without crashing.

---

## Drill Scenario & Protocol Behavior

### Scenario Setup

1. Primary Soroban RPC endpoint (`https://soroban-testnet.stellar.org`) was simulated as 100% unreachable (HTTP 503 / connection refused) via network isolation.
2. Secondary fallback RPC endpoint (`https://soroban-rpc-backup.stellar.org`) remained active and healthy.

### System Layer Reaction & Timings

| Component | Behavior Observed | Failover / Recovery Time | Invariant Maintained |
| --- | --- | --- | --- |
| **SDK Client** | Automatically detected primary RPC timeout (200ms) and switched to backup endpoint | **420ms total failover** | No transaction drop; signer identity checks preserved |
| **Indexer Service** | Logged `RPC_ENDPOINT_UNREACHABLE`, entered 5s exponential backoff, switched to secondary RPC | **1.2s resync resumption** | Zero skipped ledger sequence numbers |
| **Oracle Service** | Entered `degraded-cache` mode, served cached verdicts with `unknown` reputation fallback | **Immediate fallback** | Fraud prevention gated safely towards rejection |
| **Web App Frontend** | Displayed RPC failover status banner; transaction submission succeeded seamlessly | **<1s user-visible delay** | UI maintained responsive feedback |

---

## Documentation Updates

- Updated `docs/sdk-trust-model.md` (§"Multi-Endpoint RPC Failover Model") with verified failover timings and trust assumptions under RPC node failure.
- Updated `docs/incident-response.md` (§"Scenario E: Primary Soroban RPC Outage") with operational response procedures.
