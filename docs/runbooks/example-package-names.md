# Runbook: Example Package Names

**Control:** `scripts/check-example-package-names.mjs`
**Test:** `scripts/__tests__/check-example-package-names.test.mjs`
**CI:** `.github/workflows/sdk-package-names.yml`, job `sdk-package-names` (blocking on PRs and pushes to `main`/`dev`, weekly sweep).
**Evidence artifact:** `sdk-package-names-report` (includes `example-package-names-report.json`, 30-day retention) and a job-summary row.
**Owner:** `frontend-platform`
**Origin:** #1220 (wave-9). Builds on #1214 (example resolution) and #1218 (canonical names).

## Purpose

#1218 pins the manifests and #1214 proves the examples resolve `@iln/sdk`. Neither looks at what the examples *say*: the imports in their source, the package names in their READMEs, or whether the README's install command can install the manifest. This control closes that gap for every directory under `examples/`.

## Rules

| Rule | What fails |
|---|---|
| `example-unknown-package` | an `@iln/<name>` token in an example's source, README or manifest is not a real workspace package (typos, retired names) |
| `example-undeclared-import` | an example source file imports an `@iln/*` package its own `package.json` does not declare (or the example has no `package.json`) |
| `example-install-protocol` | the manifest uses the pnpm-only `workspace:` protocol but the README says `npm install` / `yarn install` (npm fails with `EUNSUPPORTEDPROTOCOL`) |

A line carrying `sdk-name-check: allow-legacy` is exempt (use it only in migration docs).

## Run it locally

```bash
pnpm check:example-package-names
node scripts/check-example-package-names.mjs --json=report.json
pnpm test:example-package-names
```

## Baseline (before / after)

| | Findings |
|---|---|
| Before (`dev` @ `5a0902e`) | 2 × `example-install-protocol` — `examples/governance-monitor/README.md` told readers to `npm install` (and the Docker snippet to `RUN npm install`) while its manifest depends on `@iln/sdk` via `workspace:*`. The Docker snippet also used `node:18` against `engines: >=20`. |
| After | 0 across 11 example directories |

## When the check fails

1. Open the `sdk-package-names-report` artifact or the inline `::error` annotations. Each finding names the rule, file and line.
2. Fix it:
   - `example-unknown-package`: use a real name from the message's "known" list. The stable SDK is `@iln/sdk`; the experimental one is `@iln/sdk-next`.
   - `example-undeclared-import`: add the package to the example's `package.json` (use the same specifier as the other examples, `file:../../sdk` for the SDK), or drop the import. Do not change a dependency specifier without regenerating `pnpm-lock.yaml`.
   - `example-install-protocol`: change the README to `pnpm install` (and say it runs from the repo root), or switch the manifest to a `file:` specifier **and** update `pnpm-lock.yaml`.
3. Re-run `pnpm check:example-package-names`.

## Recovery

The control is read-only and has no runtime state; a bad merge is recovered by reverting the offending example change. If the guard itself is wrong, fix `scripts/check-example-package-names.mjs` and its tests rather than adding blanket pragmas.
