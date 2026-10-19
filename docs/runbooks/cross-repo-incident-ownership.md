# Cross-Repository Incident Ownership Matrix (#1320)

This runbook establishes unambiguous ownership boundaries and escalation paths across all three core repositories in the Invoice Liquidity Network ecosystem:
1. `Invoice-Liquidity-Network` (Services & SDK)
2. `ILN-Smart-Contract` (Soroban Core)
3. `ILN-Frontend` (dApp & UI)

## Operational Manifest

The authoritative ownership matrix is machine-validated by CI from `tests/operations/cross-repo-ownership.json`.

## SLA Hierarchy

- **Critical Protocol Drift / Contract State Disruption**: 15 minutes acknowledgement
- **Service Dependency / Webhook Outages**: 30 minutes acknowledgement

## Validation

```bash
pnpm test:ownership-matrix
```
