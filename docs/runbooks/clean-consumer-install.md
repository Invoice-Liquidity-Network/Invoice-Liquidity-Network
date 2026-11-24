# Runbook: Clean Consumer Install

**Control:** `scripts/check-clean-consumer-install.mjs`
**Test:** `scripts/__tests__/check-clean-consumer-install.test.mjs`
**CI:** `.github/workflows/sdk-package-names.yml`, job `clean-consumer-install` (blocking on PRs and pushes to `main`/`dev`, weekly sweep).
**Evidence artifact:** `clean-consumer-install-report.json` (tarball names, sizes and SHA-256, npm/pnpm/node versions, install time, every check, findings; 30-day retention) and a job-summary row.
**Owner:** `frontend-platform`
**Origin:** #1223 (wave-9). Complements the pack smoke (#1212, [sdk-rc-smoke.md](sdk-rc-smoke.md)).

## Purpose

#1212 proves a packed tarball is internally consistent once extracted. It never *installs* one. A real integrator starts from an empty project, runs `npm install`, and then `require`s / `import`s / type-checks against whatever lands in `node_modules` — transitive dependencies, peers and nested copies included. This control reproduces that, hermetically (no `@iln/*` package is on the npm registry yet, so it installs the locally packed tarballs).

## What it does

1. `pnpm pack` each target (`@iln/sdk`, `@iln/shared`; `@iln/react` with `--include-react`). pnpm rewrites `workspace:*` to the real version exactly as `pnpm publish` does; `npm pack` would ship an unresolvable `workspace:*`.
2. Write an empty consumer project whose dependencies are those tarballs. `overrides` keep transitive `@iln/*` dependencies on the local tarballs.
3. `npm install` it from scratch (`--ignore-scripts`, no lockfile).
4. Verify what the consumer sees.

## Rules

| Rule | What fails |
|---|---|
| `pack-failed` | a package could not be built/packed or has no `dist/` |
| `install-failed` | `npm install` failed (unmet peer, unresolvable specifier, missing transitive dependency), or a target did not land in `node_modules` |
| `duplicate-copy` | more than one installed copy of an SDK package — two SDK instances at runtime |
| `peer-identity` | a package that peers on `@iln/sdk` resolves a different file than the consumer's own `@iln/sdk` |
| `cjs-resolve` / `esm-resolve` | `require()` / `import()` of an entry point (`@iln/sdk`, `@iln/sdk/legacy`, …) failed |
| `symbol-missing` | an entry point loads but lacks a required export (`ILNSdk`, `ILN_TESTNET`, `createKeypairSigner`, `SDK_VERSION`, …) |
| `types-unresolved` | TypeScript (Bundler and Node16 resolution) does not resolve an entry point to a `.d.ts` inside the consumer's `node_modules`, or TypeScript is unavailable (fails closed; `--skip-types` opts out) |

## Run it locally

```bash
pnpm install
pnpm --filter @iln/shared exec tsc -p tsconfig.json     # emits dist/*.d.ts
pnpm --filter @iln/sdk exec tsup                         # emits dist/ (bundle-size budget is a separate check)
node scripts/check-clean-consumer-install.mjs --no-build --json=report.json
pnpm test:clean-consumer-install
```

Flags: `--include-react`, `--skip-types`, `--force-build`, `--no-build`, `--work-dir=<dir>`, `--keep` (keeps the consumer project for inspection).

## Baseline (before / after)

| | Result |
|---|---|
| Before (`dev` @ `5a0902e`) | no control installed a tarball into a clean project. Manual reproduction: `@iln/sdk` + `@iln/shared` install and resolve (CJS, ESM, `./legacy`, types) with a single SDK copy; `@iln/react` installs with one shared SDK copy and loads, **but cannot be type-resolved** because its build never emits `dist/types` |
| After | CI job runs the reproduction on every PR: 0 findings for `@iln/sdk` + `@iln/shared` (~3.5 s install, 7 resolution/type checks per entry) |

## Known limitation: `@iln/react` is opt-in

`@iln/react`'s build is broken at `dev` @ `5a0902e`: its second rollup config bundles `dist/esm/index.d.ts`, which the first config never emits (`declaration: false`), so `pnpm --filter @iln/react build` exits non-zero and `dist/types` is never produced. With `--include-react` the control reports exactly that as `types-unresolved`. The CI job leaves `@iln/react` off, and the report's `skipped` field says so. Once the build is fixed, add `--include-react` to the workflow step. This also activates the `peer-identity` and `duplicate-copy` checks for React in CI (both are unit-tested here, and were verified manually against locally built `dist/esm` + `dist/cjs`).

## When the check fails

1. Open `clean-consumer-install-report.json` (artifact) — each finding names the rule and package; `checks` lists everything that passed.
2. Reproduce with `--keep`, then `cd` into the printed consumer directory (under the OS temp dir) and run `npm ls @iln/sdk`.
3. Fix by rule:
   - `install-failed` with `EUNSUPPORTEDPROTOCOL`: a `workspace:` / `catalog:` specifier leaked into a packed manifest — pack with `pnpm`, not `npm`.
   - `install-failed` with `ERESOLVE`: a peer range rejects the packed version; align `peerDependencies` (see [react-peer-contract.md](react-peer-contract.md)).
   - `duplicate-copy` / `peer-identity`: a package lists the SDK in `dependencies` as well as `peerDependencies`; keep it a peer (see [sdk-package-names.md](sdk-package-names.md)).
   - `cjs-resolve` / `esm-resolve` / `symbol-missing` / `types-unresolved`: the `exports` map or `files` list drifted from the build output; compare with [sdk-export-maps.md](sdk-export-maps.md).

## Recovery

The control only reads and writes under a temp directory, which is removed unless `--keep` is set; it is safe to re-run at any time (a stale consumer directory is wiped before each run). If it blocks a release, fix the package; do not skip the job. If the npm registry is unavailable the job fails closed (`install-failed`) — re-run it when the registry recovers.
