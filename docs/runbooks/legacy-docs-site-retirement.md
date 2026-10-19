# Legacy Docs Site Retirement Runbook (#1291)

This operational specification governs the complete deprecation of the Nextra 2 `docs/` site and ensures all contributor guides reference `packages/docs` and `docs.iln.finance`.

## 1. Canonical Production Designation

- **Canonical Deployed Surface**: `packages/docs/` deployed to `https://docs.iln.finance`.
- **Legacy Source**: `docs/` is retained strictly as raw content prose source until full porting is finished, but is never deployed.

## 2. Verification

```bash
pnpm test:no-stale-docs-refs
```
