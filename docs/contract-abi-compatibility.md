# Contract ABI Compatibility Check — Issue #806, implemented by #1094

## Overview

This document describes the cross-cutting compatibility check that ensures the
SDK stays in sync with the deployed smart contract ABI/spec on every SDK
release.

## Status: Implemented (release gate)

The original plan (below, kept for history) was blocked on a `docs/contract-spec.json`
artifact that the contract repo was expected to publish. That artifact never
materialized, but an equivalent one already existed under a different name:
`backend/target/spec.json`, generated from the `backend/` git submodule (pinned
to a commit of [`ILN-Smart-Contract`](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract))
by the same `stellar contract build` / `stellar contract info --output-format json`
pipeline that already feeds `scripts/generate-shared-types.mts` and
`scripts/generate-types.ts`. Issue #1094 wires a compatibility check against
that existing artifact instead of waiting on a new one.

### What is checked

`scripts/check-contract-abi-compatibility.mjs` compares a small,
hand-maintained manifest (`CONTRACT_CALL_MANIFEST` in that file) — every
contract method `packages/sdk/src/clients/InvoiceClient.ts` calls, and how
many arguments it sends — against `backend/target/spec.json`'s `FunctionV0`
entries. It fails if:

- **`MISSING_IN_SPEC`** — the SDK calls a contract method that no longer
  exists in the deployed ABI (renamed or removed).
- **`ARITY_MISMATCH`** — the deployed ABI now declares a different number of
  inputs for a method than the SDK is prepared to send (e.g. a new required
  parameter was added on-chain without a corresponding SDK update).

This is intentionally **not** a full TypeScript-AST-vs-XDR structural diff —
`InvoiceClient.ts` builds some argument lists via helper methods
(`buildSubmitInvoiceArgs`) with conditional optional fields, which a generic
AST walk would need bespoke handling for anyway. The manifest makes that
handling explicit and reviewable: a PR that changes how many arguments
`InvoiceClient.ts` sends for a method must update the manifest in the same
diff, the same discipline already used by
`scripts/check-no-duplicate-types.mjs` and
`scripts/check-monorepo-map-drift.mjs`.

**Known gap:** contract *events* (`env.events().publish(...)`) are not part of
`spec.json` — Soroban's contract spec only covers the invocable function
interface — so `indexer/src/event-parsers/*` cannot be cross-checked against
this artifact. Event-shape drift is a separate, unsolved risk; if it needs
closing, it requires a different data source (e.g. the contract repo
publishing an explicit event schema) and is out of scope for this check. CLI
command-flag cross-checking (`cli/src/commands/*`) is also out of scope for
now — the CLI does not call the contract directly, it goes through the SDK, so
this gate already protects it transitively.

### Where it runs

1. **`.github/workflows/ci.yml`, job `sdk-types-sync`** — runs whenever the
   `backend` submodule pin changes (i.e. whenever `ILN-Smart-Contract` ships a
   new commit that this repo picks up), right after that job builds the
   contract and generates `spec.json` for the existing shared-types sync
   check. Soft-skips with a log line if the submodule isn't initialized.
2. **`.github/workflows/sdk-release.yml`, job `contract-abi-gate`** — runs on
   every trigger (PR dry run, `v*` tag push, manual dispatch) and is a hard
   `needs:` dependency of both the `dry-run` and `publish` jobs. **This is the
   release gate**: an ABI incompatibility blocks the `pnpm publish` step, it
   is not merely reported after the fact.

### The guarantee this provides to integrators

If you depend on `@iln/sdk-next` (`packages/sdk`), a published version that
passed this gate is guaranteed to call contract methods that existed, with an
argument count the contract accepted, **at the commit the `backend` submodule
was pinned to when that version was built**. It does **not** guarantee the
submodule pin itself is the version currently live on mainnet — that is a
separate operational concern (see `docs/mainnet-launch-checklist.md` and
`docs/version-manifest.json`) — only that the SDK and the contract source it
was built and tested against agree with each other.

### Triggering this check when the contract ABI changes

Per `docs/cross-repo-sync.md`'s existing pattern, an ABI-affecting change
starts in `ILN-Smart-Contract`. The path to this repo re-checking compatibility is:

1. `ILN-Smart-Contract` merges the ABI change.
2. A PR in this repo bumps the `backend` submodule pin (`git submodule update --remote backend`, or equivalent).
3. `.github/workflows/ci.yml`'s `changes` job detects the `backend` path change and runs `sdk-types-sync`, which runs this check.
4. If `InvoiceClient.ts` and `CONTRACT_CALL_MANIFEST` haven't been updated to match, the PR fails CI before it can merge — and a subsequent SDK release is blocked by `contract-abi-gate` even if the submodule-bump PR slipped through some other way (e.g. an admin merge).

Maintainers coordinating a contract release should label the originating issue
`sync:smart-contract` (or `sync:all` if it also touches the frontend) so the
submodule-bump PR in this repo is tracked as required follow-up work, per
[docs/cross-repo-sync.md](cross-repo-sync.md#hardening-batch-coordination).

## Original plan (superseded, kept for history)

A test in `tests/contract-abi-compat.test.ts` would:

1. Load `docs/contract-spec.json` (or generate it from the WASM if unavailable).
2. Parse the contract's exported methods and types.
3. Cross-check against:
   - `packages/sdk/src/clients/InvoiceClient.ts` — method names and signatures
   - `cli/src/commands/*` — command definitions and flags
   - `indexer/src/event-parsers/*` — event parsing logic
4. Fail loudly if any consumer drifts from the spec.

This was superseded because `docs/contract-spec.json` never materialized, and
the CLI/indexer cross-checks were found to be either transitively covered
(CLI) or infeasible against this data source (indexer events — see "Known
gap" above).
