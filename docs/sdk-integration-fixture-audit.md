# SDK Integration Fixture Audit — Issue #804, closed by #1093

**Original audit date:** 2026-07-27
**Closure date:** 2026-09-26
**Auditor:** Re-verified against current `packages/sdk/src` and `@iln/sdk` (`sdk/src`) API
surfaces, and against `.github/workflows/ci.yml` / `sdk-e2e-local-node.yml`.
**Fixture directory:** `tests/sdk-integration/`

## Summary

The original audit (#804) concluded no fixes were required because
`tests/sdk-integration/` avoids importing SDK response shapes. That was true but
incomplete: it didn't check whether the fixtures matched the SDK's *interface*
contracts, only whether they hardcoded SDK *data* shapes. Re-verification found
one real gap — `MockWallet` did not conform to the SDK's `TransactionSigner`
interface at all — which is now fixed. The rest of the original conclusion holds.

## Re-verification: current state of every flagged fixture

| File | 2026-07-27 finding | 2026-09-26 re-verification |
|---|---|---|
| `src/mockWallet.ts` | Low risk — no SDK import | **Gap found and fixed.** Shape (`connect()`/`disconnect()`/`address` prop) never matched `@iln/sdk`'s real `TransactionSigner` interface (`getPublicKey()` + `signTransaction(xdr, options)`), and had zero dependency on `@iln/sdk` to catch drift. Fixed: `MockWallet.toTransactionSigner()` now returns the real `TransactionSigner` type (imported from `@iln/sdk`), so a breaking change to that interface fails this file's typecheck. |
| `src/mockNetwork.ts` | Low risk — generic `fetch` interceptor | **Confirmed still accurate.** Returns plain `ResponseLike` objects; encodes no SDK-specific DTO. No change needed. |
| `src/dataGenerators.ts` | Low risk — standalone | **Confirmed still accurate.** Local `Invoice`/`Party` types, no SDK import. |
| `src/assertions.ts` | Medium risk — may reference SDK types | **Confirmed still accurate.** Only imports the local `Invoice` type from `dataGenerators.ts` and `vitest`; no SDK import. |

## Live testnet-backed coverage: already exists, was not previously cross-referenced

The original audit didn't check whether a live-testnet equivalent existed
elsewhere in the repo. It does: **`sdk/src/integration/testnet.test.ts`** (issue
#233) runs the full invoice lifecycle (`submit_invoice` → `fund_invoice` →
`mark_paid` → `get_contract_stats` → `get_reputation`) against the real Soroban
testnet RPC and three funded testnet keypairs, gated by
`describe.skipIf(!canRun)` when secrets or testnet health are unavailable, and
runs in CI on every push to `main` (`.github/workflows/ci.yml`). A second live
path, `sdk/src/e2e/local-node.test.ts`, exercises the SDK against a local
Stellar Quickstart node via `.github/workflows/sdk-e2e-local-node.yml` (see
`docs/sdk-e2e.md`).

**Conclusion: "replace remaining mocked fixtures with live testnet-backed
fixtures" is already satisfied for the SDK's actual chain-interaction surface**
(submitting/funding/paying invoices, reading contract state). What remains
mocked in `tests/sdk-integration/` is deliberately *not* that surface — see below.

## What legitimately remains mocked, and why

| Fixture | Why it must stay mocked |
|---|---|
| `mockWallet.ts` (`MockWallet`) | Emulates wallet-connection **UX** (connect/disconnect events, in the style of a Freighter-like extension) for tests that assert how calling code reacts to connect/disconnect, not for testing the SDK's own signing logic against a real network. Real signing against testnet is already covered by `createKeypairSigner` + `testnet.test.ts`. Requiring a live wallet extension in CI is not feasible (no browser, no user to approve a signing popup). |
| `mockNetwork.ts` (`withMockFetch`) | Used by fast, offline unit tests that need to control HTTP response timing/error injection precisely (e.g. simulating a 500 or a timeout) — non-deterministic behavior a live testnet cannot reliably reproduce on demand. Real network behavior is covered by `testnet.test.ts` and `local-node.test.ts`. |

Both are declared in the CI allowlist below; the guard added by #1093 (see
next section) fails the build if a *new*, undocumented mock of a live-chain
interaction is introduced without the same kind of justification.

## Documented mocks (CI allowlist)

`scripts/check-sdk-fixture-mocks.mjs` parses the block below and fails CI if it
detects a mock of a live-chain interaction (stubbed `fetch`, a mocked
`@stellar/stellar-sdk` import, or a `Mock*` class standing in for a
wallet/RPC/Horizon/network dependency) anywhere under `tests/sdk-integration/`,
`sdk/src/integration/`, `sdk/src/e2e/`, or `packages/sdk/src/` that isn't
listed here. To add an exception, add the file path below **and** add a row to
the table above explaining why it can't be a live testnet fixture.

```text
tests/sdk-integration/src/mockWallet.ts
tests/sdk-integration/src/mockNetwork.ts
```

## CI enforcement

- Script: `scripts/check-sdk-fixture-mocks.mjs` (`pnpm check:sdk-fixture-mocks`)
- Tests: `scripts/__tests__/check-sdk-fixture-mocks.test.mjs` (`pnpm test:sdk-fixture-mocks`)
- Wired as the `sdk-fixture-mock-guard` job in `.github/workflows/ci.yml`,
  gated on the `sdk` changed-paths filter (which now includes
  `tests/sdk-integration/**`).

## Final closure status

**Closed.** One real gap (`MockWallet` vs. `TransactionSigner` drift) found and
fixed; all other fixtures re-confirmed low-risk; live-testnet coverage for the
SDK's actual chain interactions already exists and is now cross-referenced
from this doc; a CI guard now prevents this class of gap from silently
recurring for *new* mocks.
