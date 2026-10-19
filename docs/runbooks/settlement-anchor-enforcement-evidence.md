# Settlement-Anchor Enforcement Evidence Runbook (#1308)

This operational specification governs the collection, cryptographic sealing, and retention of compliance evidence proving that settlement anchor failovers and circuit breakers are actively enforced.

## 1. Compliance Audit Trail

- **SHA-256 Cryptographic Seal**: Every drill execution generates a tamper-evident hash of all enforcement metrics.
- **90-Day Retention Invariant**: Evidence bundles are retained under `.artifacts/drills/` for audit review by settlement partners and regulators.
- **Fail-Closed Verification**: CI gates assert that both degraded routing and full circuit-breaker suspensions occur deterministically.

## 2. Automated Execution

```bash
pnpm test:anchor-evidence
```
