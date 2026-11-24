---
"@iln/sdk": patch
"@iln/react": patch
---

Align the SDK package surface (wave-9 #1220–#1223).

- `@iln/sdk`: importing the deprecated `@iln/sdk/legacy` shim now emits a one-time migration warning (Node `DeprecationWarning`, code `ILN_SDK_DEPRECATED_LEGACY_IMPORT`; `console.warn` where `process.emitWarning` is unavailable). It never throws and the import still returns the same API. Silence it with `ILN_SDK_SUPPRESS_DEPRECATION_WARNINGS=1`. `sideEffects` now lists the shim's bundles so bundlers keep the warning; the canonical `@iln/sdk` entry stays tree-shakeable. See `docs/sdk-migration-guide.md#deprecated-sdk-surface`.
- `@iln/react`: declares `@iln/shared` as a dependency. Five source files import its types, but the package did not declare it, so the published `.d.ts` could not resolve them under strict (pnpm) installs.
