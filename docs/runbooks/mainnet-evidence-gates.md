# Mainnet Active Evidence Gates Specification (#1293)

This operational specification replaces static textual "Done" assertions with dynamic cryptographic evidence gates.

## Triple-Evidence Invariant

Every readiness row must satisfy three physical criteria:
1. **Physical Artifact Existence**: Target artifact must exist on disk.
2. **Content Integrity**: Target artifact must be non-empty and carry valid payload.
3. **Reproducibility**: Artifact must be regenerable via linked `reproducibleCommand`.

Static markdown "Done" text without physical backing is rejected by the gate.

## Verification

```bash
pnpm test:mainnet-evidence-gate
```
