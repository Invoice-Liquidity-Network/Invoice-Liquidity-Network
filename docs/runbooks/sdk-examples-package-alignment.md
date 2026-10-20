# SDK Examples Package Name Alignment Runbook (#1220)

This operational specification governs SDK dependency and import naming across all `examples/` projects.

## Invariant Rules

1. **Canonical Package Identity**:
   - All SDK examples must declare `@iln/sdk` or `@iln/sdk-next`.
   - Legacy names (`@invoice-liquidity/sdk`, `@invoice-liquidity/sdk-next`) are prohibited in manifests, code, and README snippets.
2. **Deterministic Resolution**:
   - Monorepo examples use `file:../../sdk` or workspace references.
3. **Automated Audit**:
   - The harness outputs `.artifacts/examples/sdk-examples-alignment-audit.json` with SHA-256 seal.

## Verification

```bash
pnpm test:sdk-examples
```
