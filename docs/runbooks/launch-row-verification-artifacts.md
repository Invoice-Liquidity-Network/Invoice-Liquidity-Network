# Launch Row Reproducible Verification Artifacts Specification (#1296)

This specification links every readiness item in `docs/mainnet-launch-checklist.md` to a concrete verification script and audited artifact output.

## Verification Invariant

1. **Deterministic Reproducibility**: Operators can reproduce proof of behavior for any checklist item using `pnpm <command>`.
2. **Artifact Inventory**: The complete mapping is serialized and signed under `.artifacts/launch/reproducible-verification-artifacts.json`.

## Verification

```bash
pnpm test:launch-artifacts
```
