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
| `tests/e2e/` | `lifecycle.test.ts` | `e2e.yml` + `e2e-nightly.yml` | Cross-package integration (contract + SDK + frontend) |
| `sdk/tests/browser/` | Playwright browser E2E | `sdk-browser-tests.yml` | SDK-in-browser correctness |
| `sdk/` (integration tests) | `test:integration` | `sdk-e2e-local-node.yml` | SDK ↔ local Stellar node contract interaction |
| `frontend/` | Playwright UI E2E | `e2e-nightly.yml` (step) | Frontend dApp acceptance tests |

---

## Scope Definition

### `tests/e2e/` — Cross-package Integration (Root Level)

**What it tests:** Genuine cross-package flows that exercise the contract, SDK,
CLI, indexer, and frontend together. These tests validate that the full system
works end-to-end — from invoice submission through funding, payment, and
verification — using a local Stellar node.

**Current status:** `tests/e2e/lifecycle.test.ts` is a **stub/skeleton**. It
defines test structure and state-transition logic (e.g., valid transitions
`Pending → Funded → Paid`), but most tests are skipped at runtime because they
require a running local Stellar node, and the mock contract IDs
(`C_MOCK_CONTRACT_ID_REPLACE_ME`) are placeholders.

**Scope rules:**
- Adding a new cross-package integration flow → `tests/e2e/`
- Adding a test that requires contract + SDK + frontend interaction → `tests/e2e/`
- Tests here should use `docker compose` to spin up a local Stellar node

### Per-package E2E — Single-package Concerns

| Package | E2E directory | What it validates |
|---|---|---|
| SDK (`sdk/`) | `sdk/tests/browser/` | SDK works in browser environment (Playwright) |
| SDK (`sdk/`) | `tests/` (integration) | SDK contract-interaction methods against local Stellar |
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

## References

- [CI/CD Pipeline](./ci-cd.md)
- [SDK E2E Local Node](./sdk-e2e.md)
- [Contributing Guide](../CONTRIBUTING.md)