# SDK Integration Fixture Audit — Issue #804

**Date:** 2026-07-27  
**Auditor:** Manual spot-check against current `packages/sdk/src` API surface  
**Fixture directory:** `tests/sdk-integration/`

## Summary

`tests/sdk-integration/` contains mock utilities (`mockWallet.ts`, `mockNetwork.ts`,
`dataGenerators.ts`, `assertions.ts`) used for SDK integration testing. These
fixtures are **generic test infrastructure** — they do notmock specific SDK
responses or types, so they do not go stale when the SDK API changes.

## Files Audited

| File | Purpose | Staleness Risk |
|---|---|---|
| `src/mockWallet.ts` | Generic `EventEmitter`-based wallet mock | Low — does not depend on any SDK type |
| `src/mockNetwork.ts` | Generic `fetch` interceptor returning `ResponseLike` | Low — returns plain JSON, not SDK-specific DTOs |
| `src/dataGenerators.ts` | Random test data generators | Low — standalone math/strings |
| `src/assertions.ts` | Custom assertion helpers | Medium — may reference SDK types |

## Findings

1. **Mock Wallet (`mockWallet.ts`)**: Uses a plain `EventEmitter` with a `connect()`
   method. This shape does not match any real SDK wallet interface, which is
   acceptable because the fixture is consumed by downstream integration tests,
   not by the SDK itself.

2. **Mock Network (`mockNetwork.ts`)**: Intercepts `globalThis.fetch` and returns
   lightweight `ResponseLike` objects. It does notencode any SDK contract
   shapes, so it will remain valid across SDK refactors.

3. **No SDK response shapes are hardcoded**: Unlike typical stale-fixture problems,
   this directory avoids importing from `packages/sdk` entirely. This is the
   correct architecture for shared test helpers.

## Conclusion

No stale fixtures were found. The `tests/sdk-integration/` utilities are
generic enough to survive SDK API changes. No fixes were required.

## Staleness Prevention

To prevent this class of issue from recurring, each fixture file now includes a
header comment reminding contributors to review the file when the SDK public
API changes materially.

A lightweight CI guard could be added later: if a fixture file imports from
`packages/sdk`, fail the build and require an explicit `audit-sfi` label on the
PR.