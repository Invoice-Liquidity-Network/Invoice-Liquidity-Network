# Oracle Rollback & Recovery Runbook Rehearsal (#1315)

This drill rehearsal verifies the operational containment and recovery workflows for **Scenario D (Oracle-Service Compromise or Malfunction)** described in `docs/incident-response.md`.

## 1. Rehearsal Sequence

1. **Anomaly Detection**: Simulated poisoned reputation score in cache.
2. **Emergency Kill-Switch**: Frontend and contract routing disabled via `NEXT_PUBLIC_ORACLE_ENABLED = false` within 15 minutes.
3. **Cache Purge**: Complete invalidation of corrupted cache partitions.
4. **Image Rollback**: Microservice deployment tag reverted to pre-release SHA-256 digest.
5. **Post-Recovery Verification**: Fresh scoring proves conservative heuristic evaluation without poisoned replay.

## 2. Automated Execution

```bash
pnpm test:oracle-rollback
```
