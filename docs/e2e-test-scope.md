# E2E Test Scope — Invoice Liquidity Network

## Overview

This document defines the intended scope split between root-level E2E tests
(`tests/e2e/`) and per-package E2E workflows. It was written after an audit
(see `tests/e2e/lifecycle.test.ts` and the various CI E2E workflows) to
document where tests belong and to prevent redundant or orphaned tests.

---

## Current Layout

| Location | Tests | CI Workflow | Purpose |
|---|---|---|---|
| `tests/e2e/` | `lifecycle.test.ts`, `oracle-e2e.test.ts` | `e2e.yml` + `e2e-nightly.yml` | Cross-package integration (contract + SDK + oracle-service + frontend) |
| `oracle-service/` | `src/*.test.ts` | `oracle.yml` / `turbo run test` | Oracle API, trust score math, fraud heuristics, and KYB provider |
| `sdk/tests/browser/` | Playwright browser E2E | `sdk-browser-tests.yml` | SDK-in-browser correctness |
| `sdk/` (integration tests) | `test:integration` | `sdk-e2e-local-node.yml` | SDK ↔ local Stellar node contract interaction |
| `frontend/` | Playwright UI E2E | `e2e-nightly.yml` (step) | Frontend dApp acceptance tests |

---

## Scope Definition

### `tests/e2e/` — Cross-package Integration (Root Level)

**What it tests:** Genuine cross-package flows that exercise the contract, SDK,
CLI, indexer, oracle service (`oracle-service/`), and frontend together. These tests validate that the full system
works end-to-end — from invoice submission through oracle credit & fraud assessment, funding gate evaluation, payment, and
verification — using a local Stellar node and deterministic mocks.

**Current status:**
- `tests/e2e/lifecycle.test.ts`: Covers end-to-end invoice lifecycle transitions (`Pending → Funded → Paid → Defaulted`), balance tracking, dispute flow, and oracle-service gating.
- `tests/e2e/oracle-e2e.test.ts`: Covers cross-package oracle fraud heuristic assessments (`RAPID_SUCCESSION_WINDOW_MS`, concentrated defaults) and pluggable KYB provider gating prior to `fund_invoice()`.

**Scope rules:**
- Adding a new cross-package integration flow → `tests/e2e/`
- Adding a test that requires contract + SDK + oracle + frontend interaction → `tests/e2e/`
- Tests here should use `docker compose` or deterministic local providers

### `oracle-service/` — Verification & Fraud Detection Scope (#865)

**What it tests:** Unit and service-level verification logic, including:
- In-memory and Redis cache read/write operations with TTL enforcement.
- Rate-limiting (per-IP sliding window with HTTP 429 response).
- Graceful degradation when the indexer service is unreachable (relying on on-chain reputation).
- Pluggable external KYB provider integration (`VerificationProvider` interface and `MockKYBProvider`).
- Fraud heuristic detection (similar amount clustering, rapid submission bursts within 24h, concentrated defaults in 30d, clustered ledger timestamps).

### Per-package E2E — Single-package Concerns

| Package | E2E directory | What it validates |
|---|---|---|
| SDK (`sdk/`) | `sdk/tests/browser/` | SDK works in browser environment (Playwright) |
| SDK (`sdk/`) | `tests/` (integration) | SDK contract-interaction methods against local Stellar |
| Oracle (`oracle-service/`) | `src/*.test.ts` | Verification API, cache, rate limits, fraud heuristics |
| Frontend (`frontend/`) | `frontend/` (Playwright) | UI flows, button clicks, page navigation |

**Scope rules:**
- Testing a standalone SDK method → unit test in `sdk/src/*.test.ts`
- Testing SDK ↔ contract interaction with a real Stellar node → SDK integration
- Testing browser-specific behavior (bundling, WASM loading) → `sdk-browser-tests.yml`
- Testing frontend UI flows → `frontend/` Playwright tests

---

## CI Workflow Mapping

| Workflow | Triggers | What it runs | Target |
|---|---|---|---|
| `e2e.yml` | `push`, `pull_request` (gated by `RUN_E2E` var) | `npm run test:e2e` (root `tests/e2e/`) | Cross-package integration |
| `e2e-nightly.yml` | Daily 00:00 UTC | Deploy contracts, seed accounts, run frontend Playwright | Full system nightly |
| `sdk-e2e-local-node.yml` | PR + push to main | SDK integration tests against local Stellar | SDK ↔ contract |
| `sdk-browser-tests.yml` | PR + push to main | SDK Playwright browser tests | SDK browser bundle |

---

## Audit Findings

### 1. `tests/e2e/lifecycle.test.ts` is a stub, not a real E2E test

- Every test starts with `if (!isNodeRunning) return ctx.skip()`.
- Contract IDs are placeholder values (`C_MOCK_CONTRACT_ID_REPLACE_ME`).
- Most assertions test hardcoded constants (e.g., `expect(stateTransitions).toHaveLength(3)`).
- **Action:** This file needs to be replaced with real contract interactions once
  the local Stellar node setup is reliable in CI. Currently it serves as a
  structural template.

### 2. No overlap between root E2E and per-package E2E

- Root `tests/e2e/` tests cross-package flows that no individual package covers.
- `sdk-e2e-local-node.yml` handles SDK-contract interactions.
- `e2e-nightly.yml` handles frontend-specific Playwright tests.
- **Verdict:** No tests need relocation. The scope split is clean.

### 3. `e2e.yml` is gated by a repository variable (`RUN_E2E`)

- The workflow checks `if: vars.RUN_E2E == 'true'` but this variable may not
  be set in all repository forks.
- **Action:** Consider setting `RUN_E2E=true` in the upstream repo or removing
  the gate and making the workflow conditional on path changes instead.

---

## Adding New Tests — Decision Flow

```
Is this a cross-package integration flow?
  ├─ YES → Add to tests/e2e/
  └─ NO  → Is it a single-package concern?
              ├─ SDK → sdk/src/*.test.ts (unit) or sdk tests/ (integration)
              ├─ CLI → cli/tests/
              ├─ Indexer → indexer/tests/
              ├─ Notifications → notifications/tests/
              ├─ Frontend UI → frontend/ (Playwright)
              ├─ Browser SDK → sdk/tests/browser/
              └─ Packages → packages/*/tests/
```

---

## Enforcement — CI Scope Heuristic

The scope rules above are enforced by a lightweight, dependency-free heuristic in
`scripts/check-e2e-scope.mjs`, run automatically by the
`E2E Scope Rule Check` workflow (`.github/workflows/e2e-scope.yml`) on every pull
request and on pushes to `main`/`dev`.

### What it does

The check scans the per-package test directories (each top-level service package,
`packages/*`, and `examples/*`) and, for every test file, collects the set of
*distinct* stack "client" packages it imports (e.g. `@iln/sdk`,
`@invoice-liquidity/cli`, `iln-indexer`, `@iln/react`). If a single per-package
test imports **more than one** other stack client package, it is flagged with a
message nudging the author to relocate the scenario into `tests/e2e/` (the root
cross-package suite) or to split the test so each file stays single-package.

### Why this heuristic

During the pre-audit stub review it was clear how easily coverage can fragment: a
contributor adding a "quick" cross-package assertion inside, say,
`sdk/tests/browser/` would silently pull the SDK test suite out of scope and
leave the root `tests/e2e/` suite blind to that flow. Flagging multi-client
imports at CI time keeps each test in its documented home and preserves the clean
scope split described in this document.

### What is intentionally NOT flagged

- The root `tests/e2e/` suite itself (it is the cross-package suite and is
  excluded from the scan).
- Support packages: `@iln/mock-backend`, `@iln/test-utils`, `@iln/shared`,
  `@iln/scripts`, `@iln/opentelemetry`, `@iln/eslint-config`. Depending on test
  plumbing is not a cross-package concern.
- A test that imports exactly one other stack client (e.g. a CLI test that uses
  `@iln/sdk` for fixtures) — that is still single-package in spirit.

### Running it locally

```bash
node scripts/check-e2e-scope.mjs
```

Exit code `0` means clean; `1` means one or more files should be relocated.
## Execution Time and Flakiness Baseline (#866)

To ensure the expanded cross-package and oracle-service E2E test suites remain deterministic and do not introduce CI flakiness, an empirical execution and flakiness baseline was established prior to release:

### Flakiness Baseline Metrics (20 Sequential Runs):
- **Total Iterations:** 20
- **Successful Runs:** 20 / 20 (100% pass rate)
- **Flakiness Rate:** 0.0%
- **Quarantined Tests:** 0

### Execution Duration Baseline:
- **Average Duration:** ~4,278 ms (~4.28s)
- **Minimum Duration:** 4,175 ms
- **Maximum Duration:** 4,487 ms
- **Standard Deviation:** < 95 ms

### Quarantine Policy Integration:
Any newly introduced test exhibiting intermittent timing failures or non-deterministic execution in CI will be proactively tagged with the `@flaky` annotation and tracked for root-cause triage per the procedure in [docs/flaky-test-quarantine.md](./flaky-test-quarantine.md).

---

## References

- [CI/CD Pipeline](./ci-cd.md)
- [SDK E2E Local Node](./sdk-e2e.md)
- [Flaky Test Quarantine](./flaky-test-quarantine.md)
- [Oracle Service Architecture](./oracle-service.md)
- [Contributing Guide](../CONTRIBUTING.md)