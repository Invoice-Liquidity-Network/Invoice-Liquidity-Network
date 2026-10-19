# External Audit Evidence Verification Specification (#1294)

This operational specification governs the verification of third-party external security audits prior to mainnet cutover.

## Audit Validation Invariants

1. **Zero Unresolved Critical/High Vulnerabilities**: Every finding of severity Critical or High must be verified as `RESOLVED` or `MITIGATED` by the auditor.
2. **Freshness Window (180 Days)**: Audit evidence older than 180 days relative to the release date requires re-audit.
3. **Formal Verdict**: The audit report manifest must declare `PASSED_FOR_MAINNET`.

## Verification

```bash
pnpm test:audit-evidence
```
