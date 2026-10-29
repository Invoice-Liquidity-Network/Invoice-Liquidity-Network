# Mutation Testing — Invoice Liquidity Network

## Overview

Mutation testing verifies that the test suite actually detects real bugs by
introducing small code changes ("mutations") and confirming the tests fail.

This project currently uses mutation testing in two contexts. On 2026-08-27, the repository-owned TypeScript packages were reviewed separately from the frontend repository: `sdk/`, `indexer/`, `notifications/`, and `oracle-service/`. The existing CI workflow only executes `packages/sdk/src/errors.ts`; it does not establish coverage for those top-level packages. The scoped review therefore records the existing SDK errors run as the baseline and treats transaction-building/signing and oracle verification as priority follow-up targets.

| Context | Tool | Target | Status |
|---|---|---|---|
| TypeScript SDK | [Stryker](https://stryker-mutator.io/) | `packages/sdk/src/errors.ts` | ✅ Implemented & CI-wired |
| Indexer event-processing | [Stryker](https://stryker-mutator.io/) | `indexer/src/processor.ts` | ✅ Implemented & CI-wired (#1085) |
| Oracle composition | [Stryker](https://stryker-mutator.io/) | `oracle-service/src/composition.ts`, `oracle-service/src/verifier.ts` | ✅ Implemented & CI-wired (#1085) |
| Rust Smart Contract | [cargo-mutants](https://mutants.rs/) | `contracts/invoice_liquidity/src/lib.rs` | ⏳ Proposal (see below) |

**Target mutation score: ≥ 80%** for the SDK errors module, indexer event-processing, and oracle composition logic.

---

## Stryker (TypeScript) — Implemented

### Configuration

- Config file: `packages/sdk/stryker.config.mjs`
- Runner: `pnpm test:mutation` (from `packages/sdk/`)
- CI: `.github/workflows/mutation-testing.yml`
  - **Scheduled**: runs weekly (Sunday 06:00 UTC)
  - **PR-triggered**: runs on changes to errors.ts, processor.ts, composition.ts, verifier.ts, or Stryker config
  - **Non-blocking**: results are advisory; the job uses `continue-on-error: true`
  - **Artifacts**: HTML mutation reports uploaded with 30-day retention

### Current Target

**`packages/sdk/src/errors.ts`** — a high-value, self-contained module:

- 20+ structured error classes (ILNError hierarchy)
- `parseContractError()` — mapping numeric/string contract errors to typed errors
- `normalizeError()` — converting arbitrary thrown values to ILNError
- 35+ test cases in `packages/sdk/src/errors.test.ts`
- No external dependencies (pure TypeScript logic)
- Fast mutation run (< 30 seconds on CI)

### Repository-owned package review baseline (2026-08-27)

| Package | Existing mutation configuration/result | Review outcome |
|---|---|---|
| `sdk/` | Stryker is configured only for `packages/sdk/src/errors.ts`; no top-level `sdk/` target is wired | Signing and transaction-building tests must be targeted separately; do not infer coverage from the frontend repo |
| `indexer/` | No package mutation target configured | Rate limiting and GraphQL admission controls are covered by adversarial tests, but mutation testing remains a follow-up target |
| `notifications/` | No package mutation target configured | No mutation result was available in the current workflow |
| `oracle-service/` | No package mutation target configured | Verification branches have unit coverage; no mutation score is claimed |

Priority remediation from this review: enforce exact IP parsing for the indexer whitelist and reject GraphQL requests above documented depth/complexity limits. These controls are now tested; future mutation runs should include their boundary predicates and the SDK signer pipeline.

---

## Indexer Event-Processing Mutation Testing — Implemented (#1085)

**Target:** `indexer/src/processor.ts` — the event-processing pipeline that
transforms raw ledger events into invoice state transitions. This is one of the
two most correctness-critical code paths in the repository.

**CI job:** `indexer-mutation` in `.github/workflows/mutation-testing.yml`
**PR trigger:** changes to `indexer/src/**` or `indexer/tests/**`
**Report:** `mutation-report-indexer` artifact (30-day retention)

### Why processor.ts

A mutation to a state-transition condition (e.g. changing `===` to `!==` in
a status check) would silently corrupt invoice records. The existing unit
tests cover the happy path, but mutation testing verifies that boundary
conditions and error paths are also caught.

---

## Oracle-Service Composition Mutation Testing — Implemented (#1085)

**Target:** `oracle-service/src/composition.ts` and `oracle-service/src/verifier.ts` —
the signal-composition and verification logic that determines whether an
invoice is trustworthy enough to fund. This is the second most
correctness-critical code path.

**CI job:** `oracle-mutation` in `.github/workflows/mutation-testing.yml`
**PR trigger:** changes to `oracle-service/src/**`
**Report:** `mutation-report-oracle` artifact (30-day retention)

### Why composition.ts + verifier.ts

A mutation to the fraud-signal threshold or the composition weight would
silently change which invoices are approved/rejected, directly affecting
protocol solvency. These modules already have 90+ test cases; mutation
testing confirms no regression path is untested.

## Adding New Stryker Targets

To add mutation testing for another SDK module:

1. Add the file path to the `mutate` array in `stryker.config.mjs`.
2. Ensure the module has a corresponding `.test.ts` file with adequate coverage.
3. The CI workflow automatically picks up the new target on the next run.

---

## cargo-mutants (Rust Smart Contract) — Proposed / Future Work

The original vision for mutation testing was to run
[cargo-mutants](https://mutants.rs/) against the Rust smart contract at
`contracts/invoice_liquidity/src/lib.rs`. This capability is **not yet
implemented** for the following reasons:

- The smart contract lives in a separate repository
  (`Invoice-Liquidity-Network/ILN-Smart-Contract`), included here as a git
  submodule.
- Setting up `cargo-mutants` requires Rust toolchain and is slower than the
  TypeScript Stryker runs (10-30 minutes per run).
- A CI workflow for Rust mutation testing would need to be implemented in the
  `ILN-Smart-Contract` repo or in this repo with access to the submodule.

**To implement in the future:**

1. Install `cargo-mutants`: `cargo install cargo-mutants`
2. Run: `cargo mutants --package invoice_liquidity`
3. Results are written to `mutants.out/` in the workspace root.
4. Add a CI workflow similar to `mutation-testing.yml` targeting
   `./backend/contracts/invoice_liquidity/`.

> **Status:** This doc has been updated to describe the **actual current state**
> (Stryker for SDK errors) alongside the **proposed future work** (cargo-mutants
> for the Rust contract).

---

## Known Surviving Mutations

The following mutations are **expected survivors** for the Rust contract target
— they are semantically equivalent to the original code in all reachable paths,
or they affect code paths that are intentionally left unchecked:

### 1. `notify_distribution_*` early-return branches

```rust
// In notify_distribution_funding / notify_distribution_settlement:
let Some(dist_contract) = env.storage()...get::<_, Address>(...) else {
    return; // ← mutating this early return has no observable effect in unit tests
};
```

**Why it survives:** The distribution contract is not set in unit tests.
The early return is exercised (no panic) but any mutation to it would still
pass all tests because the notification path is a fire-and-forget side effect
not directly observable in the contract's return values.

**Mitigation:** Integration/e2e tests that set a distribution contract would
catch mutations here. See `tests_distribution.rs` for partial coverage.

---

### 2. `invoice.funder = Some(funder.clone())` assignment in `fund_invoice`

```rust
invoice.funder = Some(funder.clone()); // Legacy support comment
```

**Why it survives:** The funder field is only set when `amount_funded == amount`
(full funding). Tests verify `invoice.funder == Some(t.funder)` post-fund, so
mutations that change this assignment (e.g., `None`) would be caught. However,
mutations that change the *condition* for this line (e.g., always assign vs
only on full fund) may survive if partial-fund tests don't check `funder`.

**Mitigation:** `mt02` and existing funder-field tests cover most paths.

---

### 3. `discount_rate_as_i128` cast

```rust
fn discount_rate_as_i128(rate: u32) -> i128 { rate as i128 }
```

**Why it survives:** This is a pure type cast. Mutations here (e.g., return
a constant) would be caught by existing arithmetic tests.

---

## Adding New Tests

When a mutation testing tool reports a new survivor:

### Stryker (TypeScript)

1. Identify the mutated line and what invariant it violates.
2. Add a targeted test to the relevant `.test.ts` file that asserts the exact
   boundary value differentiating the original from the mutant.
3. Re-run `pnpm test:mutation` to confirm the new test kills the mutation.

### cargo-mutants (Rust)

1. Identify the mutated line and what invariant it violates.
2. Add a targeted test to `src/tests_mutation.rs` that asserts the exact
   boundary value differentiating the original from the mutant.
3. Re-run `make mutants` to confirm the new test kills the mutation.
4. Document the mutation in the table above.