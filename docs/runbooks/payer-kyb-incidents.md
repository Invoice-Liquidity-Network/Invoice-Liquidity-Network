# Operator Runbook: Payer Authorization & KYB Incidents (#1240)

This operational runbook provides incident classification, triage procedures, failover protocols, and emergency escalation paths for payer authorization anomalies and KYB provider outages in the Oracle service.

---

## 1. Payer Authorization Taxonomy & Incident Triggers

The oracle service partitions all verification denials into machine-readable taxonomy codes (ref: `oracle-service/src/index.ts:944`):

| Taxonomy Code | Severity | Description | Immediate Action |
|---|---|---|---|
| `KYB_PROVIDER_DOWN` | SEV-2 | Primary KYB provider (mock/vendor) timing out or returning 5xx | Engage degraded mode or switch to secondary provider |
| `FRAUD_SPIKE_DETECTED` | SEV-1 | Sudden surge (>25%) in rejected fraud signals across payers | Investigate potential coordinated attack; prepare contract pause |
| `PAYER_IDENTITY_INVALID` | SEV-3 | Payer tax ID, registration, or LEI format mismatch | Return validation error to invoice creator; no ops action |
| `PAYER_SANCTIONED` | SEV-1 | Payer matches OFAC or global sanctions screening lists | Hard reject; log compliance audit record |
| `RAPID_SUCCESSION_ANOMALY`| SEV-2 | Multiple high-value invoices submitted in rapid succession | Trigger volatile cache purge and manual risk escalation |

---

## 2. Triage & Incident Flowchart

```
[Prometheus Alert: PayerAuthorizationSpike / KYBProviderLatency]
                          │
                          ▼
            Is KYB Provider Responding?
                  │               │
                 Yes              No
                  │               │
                  ▼               ▼
      Inspect Fraud Taxonomy   Engage Degraded Cache Mode
                  │               │
  ┌───────────────┴───────────────┴───────────────┐
  ▼                                               ▼
Sanction / Fraud Attack                 Provider Unscheduled Outage
Action: Engage Circuit Breaker           Action: Re-route via Secondary
Contact: @security-lead                  Contact: @infra-lead
```

---

## 3. Degraded Mode & Failover Enforcement

1. **Last-Known-Good Cache Replay**:
   - The verifier can serve cached verdicts with `deltaGuard` protection if data age is within allowed TTL (`< 3600s`).
   - Stale cache beyond TTL must fail closed.
2. **Provider Failover Command**:
   - `pnpm --filter oracle-service start --provider=secondary`
3. **Emergency Circuit Breaker Trigger**:
   - If unconfirmed fraudulent invoices bypass filters:
   - Execute: `pnpm drill:oracle-rollback`

---

## 4. Post-Incident Review Checklist

- [ ] Verify Prometheus `oracle_payer_authorizations_total` returns to baseline.
- [ ] Flush volatile cache for affected payer addresses: `POST /v1/cache/purge`.
- [ ] Record incident report with root-cause taxonomy and resolution timestamp.
