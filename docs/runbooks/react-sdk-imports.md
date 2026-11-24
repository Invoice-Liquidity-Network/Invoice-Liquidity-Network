# Runbook: @iln/react SDK Imports

**Control:** `scripts/check-react-sdk-imports.mjs`
**Test:** `scripts/__tests__/check-react-sdk-imports.test.mjs`
**CI:** `.github/workflows/sdk-package-names.yml`, job `sdk-package-names` (blocking on PRs and pushes to `main`/`dev`, weekly sweep).
**Evidence artifact:** `sdk-package-names-report` (includes `react-sdk-imports-report.json`, 30-day retention) and a job-summary row.
**Owner:** `frontend-platform`
**Origin:** #1221 (wave-9). Complements the peer-dependency contract (#1213, [react-peer-contract.md](react-peer-contract.md)) and the canonical names (#1218, [sdk-package-names.md](sdk-package-names.md)).

## Purpose

`@iln/react` is built on the stable SDK (`sdk/` → `@iln/sdk`), declared as a **peer** so the host app and the React hooks share one SDK instance. #1213 guards the peer ranges; #1218 guards the names. Neither checks what `packages/react/src` actually imports. A wrong import silently loads a second SDK (separate `ILNError` classes, separate caches) or only resolves through hoisting.

## Rules

Scanned: every file under `packages/react/src`, tests included.

| Rule | What fails |
|---|---|
| `react-sdk-specifier` | SDK imports that are not the bare `@iln/sdk` entry: `@iln/sdk-next` (experimental, different API), deep imports (`@iln/sdk/dist/…`, the deprecated `@iln/sdk/legacy`), or relative paths into `sdk/` / `packages/sdk/` |
| `react-undeclared-import` | an `@iln/*` package is imported but not declared in `packages/react/package.json` |
| `react-sdk-missing-export` | a named import from `@iln/sdk` is not exported by `sdk/src/index.ts` (resolved through its re-exports). If the export graph cannot be resolved the rule **fails closed** |

## Run it locally

```bash
pnpm check:react-sdk-imports
node scripts/check-react-sdk-imports.mjs --json=report.json
pnpm test:react-sdk-imports
```

## Baseline (before / after)

| | Findings |
|---|---|
| Before (`dev` @ `5a0902e`) | 5 × `react-undeclared-import` — `@iln/shared` is imported (type-only) by `AdminArbitrationDashboard.tsx`, `DisputeInvoiceModal.tsx`, `EvidenceViewer.tsx`, `EvidenceViewer.test.tsx`, `useDispute.ts` but was declared nowhere in `packages/react/package.json`, so the published `.d.ts` referenced a package consumers' strict installs could not resolve |
| After | 0 across 80 files; 299 SDK exports resolved; all named imports present |

Fix applied: `@iln/shared` is now a `dependencies` entry (`workspace:*`, rewritten to `0.1.0` by `pnpm pack`) with the matching `pnpm-lock.yaml` importer entry. `@iln/sdk` stays a peer.

## When the check fails

1. Open the `sdk-package-names-report` artifact or the inline `::error` annotations.
2. Fix it:
   - `react-sdk-specifier`: import from `@iln/sdk`. Anything the shim or `dist/` exposes is available from the root entry.
   - `react-undeclared-import`: declare the package (`dependencies` for runtime/type packages consumers need, `peerDependencies` for shared singletons) **and** update `pnpm-lock.yaml`.
   - `react-sdk-missing-export`: either export the symbol from the SDK or stop importing it. If the message says the graph cannot be resolved, someone added `export * from '<bare package>'` to the SDK entry; re-export explicitly instead.
3. Re-run `pnpm check:react-sdk-imports`.

## Recovery

Read-only control, no runtime state. Revert the offending change; if the guard is wrong, fix the script and its tests, not the pragma.
