# Runbook: SDK Deprecation Notices

**Runtime control:** `sdk/src/deprecation.ts` (`warnDeprecated`), called by `sdk/src/legacy-imports.ts`
**Tests:** `sdk/src/deprecation.test.ts`, `sdk/src/legacy-imports.test.ts`
**CI guard:** `scripts/check-sdk-deprecations.mjs` (`scripts/__tests__/check-sdk-deprecations.test.mjs`) in `.github/workflows/sdk-package-names.yml`, job `sdk-package-names`
**Evidence artifact:** `sdk-package-names-report` (includes `sdk-deprecations-report.json`, 30-day retention) and a job-summary row. Operators see the control fire in their own logs (below).
**Owner:** `frontend-platform`
**Origin:** #1222 (wave-9). The shim is from #1219.

## Purpose

`@iln/sdk/legacy` re-exports the public API so old import sites keep working. It is a migration aid scheduled for removal in `1.0.0`, but it was silent: nothing told an integrator they were on a path that is going away. The registry in `sdk/src/deprecation.ts` now warns at runtime, and the guard keeps each warning wired, tested and documented.

## Behaviour (the contract)

| Property | Behaviour |
|---|---|
| Trigger | loading `@iln/sdk/legacy` (ESM or CJS). The canonical `@iln/sdk` entry never warns |
| Frequency | once per notice per process. A restart emits it again |
| Channel | Node `DeprecationWarning` with code `ILN_SDK_DEPRECATED_LEGACY_IMPORT` (stderr, `process.on('warning')`, honours `--no-deprecation`); `console.warn` where `process.emitWarning` is absent (browsers, React Native) |
| Silence | `ILN_SDK_SUPPRESS_DEPRECATION_WARNINGS=1` (or `true`). A suppressed call does not use up the once-only slot |
| Safety | never throws, never changes the import's return value; a failing sink is swallowed and not retried (no warning storm) |
| Tree-shaking | `sdk/package.json` `sideEffects` lists `./dist/legacy-imports.mjs` and `.cjs` so bundlers keep the warning |

## Finding services still on the shim

Search service logs for the code:

```bash
grep -r "ILN_SDK_DEPRECATED_LEGACY_IMPORT" /var/log/<service>/
```

or subscribe in-process: `process.on('warning', (w) => w.code === 'ILN_SDK_DEPRECATED_LEGACY_IMPORT' && metrics.inc('iln_sdk_legacy_import'))`. Migrate by changing the specifier to `@iln/sdk` (see [sdk-migration-guide.md](../sdk-migration-guide.md#deprecated-sdk-surface)).

## CI guard rules

| Rule | What fails |
|---|---|
| `notice-not-wired` | a notice is declared in `DEPRECATION_NOTICES` but no SDK source calls `warnDeprecated('<id>')` |
| `notice-uncatalogued` | `warnDeprecated('<id>')` uses an id missing from the registry (it would silently no-op) |
| `notice-untested` | no `sdk/src/**/*.test.ts` references the notice |
| `notice-undocumented` | the migration guide lacks the notice's heading, its warning code, or the suppression env var |
| `side-effects-dropped` | a module that warns at load time has no matching `sideEffects` entries in `sdk/package.json` |

```bash
pnpm check:sdk-deprecations
pnpm test:sdk-deprecations
pnpm --filter @iln/sdk exec vitest run src/deprecation.test.ts src/legacy-imports.test.ts
```

## Adding a new deprecation

1. Add an entry to `DEPRECATION_NOTICES` (`id`, `code` = `ILN_SDK_DEPRECATED_*`, `surface`, `replacement`, `removedIn`, `docs`).
2. Call `warnDeprecated('<id>')` at the deprecated surface (module top level for an entry point, inside the function for an API).
3. Add a row and a heading target to `docs/sdk-migration-guide.md`; mention the code.
4. Add a test (success, suppression, restart). If the call is at module top level, add the built `dist/<name>.mjs|cjs` to `sideEffects`.

## Baseline (before / after)

| | Result |
|---|---|
| Before (`dev` @ `5a0902e`) | `require('@iln/sdk/legacy')` and `import '@iln/sdk/legacy'` were silent; `DEPRECATION_WARNINGS` in `compatibility.ts` named methods (`getVersion`, `getContractVersion`) that the client does not define and nothing emitted from them; the guide did not mention the shim |
| After | built bundles warn once on stderr (`(node:N) [ILN_SDK_DEPRECATED_LEGACY_IMPORT] DeprecationWarning: …`) for both ESM and CJS, stay silent with `ILN_SDK_SUPPRESS_DEPRECATION_WARNINGS=1`, and the guard reports 1 notice wired, tested and documented |

## Recovery

If the warning is noisy in a deployment you cannot migrate yet, set `ILN_SDK_SUPPRESS_DEPRECATION_WARNINGS=1` — behaviour is otherwise identical. To roll the control back entirely, revert the `warnDeprecated` call in `legacy-imports.ts` and the `sideEffects` change together, then remove the notice from the registry so the guard stays green.
