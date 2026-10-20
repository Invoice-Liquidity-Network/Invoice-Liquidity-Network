# Oracle Rollback & Recovery Runbook (#1315)

This operational specification governs emergency procedure Scenario D (Oracle Compromise / Malfunction): cache poisoning, rogue scoring, kill-switch gating, and reproducible image rollback.

## Emergency Response Workflow

```
[Prometheus Alert: OracleMalfunction / ScoreInflation]
                         │
                         ▼
             Step 1: Emergency Kill-Switch
         `NEXT_PUBLIC_ORACLE_ENABLED = false`
                         │
                         ▼
             Step 2: Flush Poisoned Cache
                 `POST /v1/cache/purge`
                         │
                         ▼
        Step 3: Rollback Container Digest
      `DEPLOY_IMAGE = verified-pre-incident-sha`
                         │
                         ▼
        Step 4: Re-enable & Verify Health
            `pnpm drill:oracle-rollback`
                         │
                         ▼
      Step 5: Persist Signed Evidence Bundle
   `.artifacts/drills/drill-oracle-rollback-recovery.json`
```

## Invariant Protections

1. **Kill-Switch Fallback**: Disabling the oracle forces the frontend and contract interactions into conservative static bounds rather than throwing unhandled runtime exceptions.
2. **Deterministic Artifact**: Every rehearsal execution emits a machine-readable JSON bundle with SHA-256 seal under `.artifacts/drills/`.

## Verification

```bash
pnpm test:oracle-rollback
```
