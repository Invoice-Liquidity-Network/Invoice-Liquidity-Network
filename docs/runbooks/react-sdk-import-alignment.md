# React Package Canonical SDK Import Alignment Runbook (#1221)

This operational specification governs the import alignment of `@iln/react` with the canonical `@iln/sdk` package.

## 1. Dependency Invariants
- `packages/react/package.json` must declare `@iln/sdk` in `peerDependencies` with compatible semver (`^0.1.0`).
- `devDependencies` must pin `@iln/sdk: "workspace:*"` for monorepo development.
- Zero occurrences of legacy `@invoice-liquidity/sdk` are permitted across source, package manifests, or rollup configs.

## 2. Re-Export Invariants
- `packages/react/src/index.ts` re-exports `type { ILNClient }` from `@iln/sdk` so React consumers avoid fragmented imports.

## 3. Verification

```bash
pnpm test:react-sdk-alignment
```
