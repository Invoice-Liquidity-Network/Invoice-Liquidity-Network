# Per-Workspace Test Runtime Budgets — Issue #808 / #1092

## Overview

Individual test suites can grow slow over time without anyone noticing until
CI feels sluggish. This document defines the runtime budget system that makes
regressions visible immediately and attributable to the change that caused them.

**Status**: the original version of this document (Issue #808) described this
system aspirationally — no script or CI step actually measured or enforced
anything. Auditing the repo for Issue #1092 confirmed that gap: `sdk/`, `cli/`,
`indexer/`, and `notifications/` were listed with budgets, but nothing ran
those numbers against reality, and `oracle-service/`, `backend/`, every
`packages/*` workspace, and the root `scripts/__tests__` vitest suite weren't
listed at all. This revision closes both gaps: every testable package in the
monorepo now has a budget, and `scripts/check-test-runtime-budgets.mjs`
enforces it in CI as a hard failure.

## Full-Monorepo Budgets

Source of truth: [`test-runtime-budgets.json`](../test-runtime-budgets.json).
"Measured" is from the first full-monorepo `turbo run test --summarize` pass
run while building this out; budgets are set with headroom above it (per the
"Updating a Budget" policy below), except where noted.

| Package | Path | Measured | Budget | Enforced via |
|---|---|---|---|---|
| `@iln/sdk` | `sdk/` | 17.0s | 60s | turbo summary |
| `@invoice-liquidity/cli` | `cli/` | 14.9s | 45s | turbo summary |
| `iln-indexer` | `indexer/` | 24.8s | 60s | turbo summary |
| `@iln/oracle-service` | `oracle-service/` | 17.4s | 30s | turbo summary *(new — was previously unlisted)* |
| `iln-notifications` | `notifications/` | **68.6s** | 90s | turbo summary *(⚠️ see note below — was previously budgeted at 30s, unenforced)* |
| `@iln/react` | `packages/react/` | 34.6s | 50s | turbo summary *(new)* |
| `@iln/mock-backend` | `packages/mock-backend/` | 7.0s | 20s | turbo summary *(new)* |
| `@iln/opentelemetry` | `packages/opentelemetry/` | <1s | 15s | turbo summary *(new)* |
| `@iln/upgrade-tests` | `packages/upgrade-tests/` | 9.7s | 20s | turbo summary *(new)* |
| `@iln/test-utils` | `packages/test-utils/` | 21.5s | 35s | turbo summary *(new)* |
| `@iln/indexer` | `packages/indexer/` | 17.7s | 30s | turbo summary *(new — jest, not vitest)* |
| `@iln/shared` | `packages/shared/` | 18.0s | 30s | turbo summary *(new — `tsc` + `tsd` type-check, not a runtime test suite)* |
| `@iln/sdk-next` | `packages/sdk/` | 34.0s | 50s | turbo summary *(new — jest, not vitest)* |
| `@invoice-liquidity/docs` | `docs/` | 20.8s | 35s | turbo summary *(new)* |
| `root-scripts` | `scripts/__tests__/` | 0.6–1.5s | 15s | bash-timed step + `--external` *(new — see caveat below)* |
| `backend` | `backend/` (Rust submodule) | *unmeasured* | 180s | bash-timed step in `ci.yml::test`, enforced inline via `jq` (no Node/pnpm environment in that job) |

**Excluded — no test script, nothing to budget**: `packages/eslint-config`, `packages/docs` (`@invoice-liquidity/docs-next`), `packages/scripts`. `examples/*` are also excluded — they're consumer-facing example apps exercised by the SDK backward-compatibility matrix (Issue #1035), not part of this repo's own test-suite governance.

**Caveat on `root-scripts`**: `scripts/__tests__` contains a mix of vitest files (`.test.ts`) and standalone `node --test` files (`.test.js`/`.test.mjs`, already run separately via `npm run test:checklist`/`test:audit`/`test:provenance`). The budgeted figure covers only the vitest-run `.test.ts` files, and excludes `check-compatibility.test.ts`, which currently fails to even load due to a pre-existing bug (`scripts/check-compatibility.ts` declares `const matrix` twice in the same scope) unrelated to this issue — flagged here for whoever owns that script, not fixed as part of this change. `test:drift` (`check-monorepo-map-drift.test.mjs`) and `test:alert-runbook` (`check-alert-runbook-links.test.mjs`) are two more `.mjs` suites in this directory not currently wired into any CI job at all; that's a pre-existing gap this issue doesn't close either, since fixing *what runs in CI* is a different problem from *budgeting what already does*.

**Caveat on `backend`**: the Rust submodule wasn't checked out in the environment this audit was performed in, so its 180s budget is a placeholder based on the other Rust-heavy jobs' estimated duration (see [docs/ci-duration-cost-audit.md](./ci-duration-cost-audit.md)), not a real measurement. It self-corrects on the first CI run after merge — the `jq`-based check in `ci.yml::test` will report the real number and fail loudly if it's already over 180s.

## CI Enforcement

`scripts/check-test-runtime-budgets.mjs` reads `test-runtime-budgets.json` and,
for each budget, sources its measured duration:

- **`measuredVia: "turbo"`** — the `<package>#test` (or `#test:coverage`) task
  from a `turbo run test --summarize` run summary (`.turbo/runs/*.json`).
  `ci.yml::core-test` passes `--summarize` on its existing `turbo run test`
  step and feeds the resulting summary to the checker — no extra test runs.
- **`measuredVia: "external"`** — a duration supplied via `--external
  <package>=<seconds>`, for suites turbo doesn't track. Used today for
  `root-scripts`: `ci.yml::core-test` times the `pnpm exec vitest run
  scripts/__tests__` step itself with `date +%s.%N` and passes the result.
- **`measuredVia: "external-bash"`** — enforced entirely inside a CI job's
  own shell step, with no Node/pnpm available. Used only for `backend`
  (`ci.yml::test`, via `jq` reading `test-runtime-budgets.json` directly).
  The checker script skips these — they're listed here for the audit table,
  not for it to enforce.

If a budgeted package's measured duration exceeds its budget — or a
`turbo`/`external` package has **no** measurement at all, meaning nothing
actually checked it — the script exits 1 and **fails the job**, unlike the
non-blocking "warning annotation" this document originally proposed. There is
no partial-enforcement package today: every listed budget is a hard gate,
"consistent with the existing enforced packages" once this change lands.

Run locally:

```bash
pnpm exec turbo run test --summarize
pnpm run test:runtime-budgets   # auto-discovers the newest .turbo/runs/*.json
```

## Updating a Budget

1. Measure the new runtime on `main` (`pnpm exec turbo run test --summarize`, then read the relevant task's duration from `.turbo/runs/*.json`, or `pnpm run test:runtime-budgets` for the printed summary).
2. Open a PR updating the number in `test-runtime-budgets.json` **and** the table above.
3. Explain the legitimate reason for the increase in the PR description (new tests, a fixture that got heavier, etc.) — this document's whole purpose is making increases visible and attributable, so an unexplained bump defeats it.

## References

- [`test-runtime-budgets.json`](../test-runtime-budgets.json) — machine-readable source of truth
- [`scripts/check-test-runtime-budgets.mjs`](../scripts/check-test-runtime-budgets.mjs) — enforcement script
- [docs/ci-duration-cost-audit.md](./ci-duration-cost-audit.md) — workflow-level duration/cost context
- [CONTRIBUTING.md](../CONTRIBUTING.md)
