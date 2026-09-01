# CI Duration & Cost Audit

> **Issue #963** — Proactive capacity planning before CI becomes a contributor-friction problem.
>
> Generated: 2026-08-30

---

## 1. Workflow inventory

| # | Workflow | Trigger(s) | Estimated duration | Notes |
|---|---------|-----------|-------------------|-------|
| 1 | `ci.yml` | push main, all PRs | **8–12 min** | Core quality gate: install → format + lint + type-check → test → build |
| 2 | `coverage.yml` | push main, PR to main | **5–8 min** | Rust + Node.js coverage per package, uploads to Codecov |
| 3 | `e2e.yml` | push main/dev, PR to main/dev | **10–20 min** | Docker-based E2E with local Stellar node |
| 4 | `e2e-nightly.yml` | daily 00:00 UTC | **20–30 min** | Full E2E suite, same Docker setup as `e2e.yml` |
| 5 | `e2e-scope.yml` | all PRs, push main/dev | **<1 min** | Lightweight scope heuristic (no deps needed) |
| 6 | `sdk-e2e-local-node.yml` | push main | **15–25 min** | Docker Stellar + SDK E2E tests |
| 7 | `sdk-browser-tests.yml` | push/PR on packages/sdk | **3–5 min** | Browser compatibility tests |
| 8 | `sdk-bundle-size.yml` | push/PR on sdk paths | **3–5 min** | Bundle size check |
| 9 | `sdk-api-docs.yml` | push/PR on packages/sdk/src | **2–3 min** | TypeDoc generation |
| 10 | `sdk-release.yml` | tags, PR to main | **3–5 min** | npm publish with provenance |
| 11 | `cli-docs.yml` | push/PR on cli/src | **2–3 min** | CLI docs generation |
| 12 | `cli-smoke.yml` | push main on cli/sdk paths | **2–3 min** | npm pack + install smoke |
| 13 | `knip.yml` | push/PR to main | **3–5 min** | Dead code detection |
| 14 | `codeql.yml` | push/PR to main, weekly | **10–15 min** | Security scanning (JS/TS + Rust) |
| 15 | `snyk.yml` | push/PR to main, weekly | **5–10 min** | Dependency vulnerability scan |
| 16 | `pr-title-lint.yml` | all PRs | **<1 min** | Conventional commit lint |
| 17 | `changeset-check.yml` | PR on packages/sdk | **<1 min** | Changeset enforcement |
| 18 | `docs-deploy.yml` | push/PR on docs paths | **3–5 min** | Documentation build/deploy |
| 19 | `docs-link-check.yml` | push/PR on docs paths, weekly | **2–5 min** | Broken link detection |
| 20 | `docs-changelog.yml` | push tags/main, manual | **1–2 min** | Changelog aggregation |
| 21 | `indexer-migrations.yml` | push/PR on indexer paths | **2–3 min** | Migration schema verification |
| 22 | `indexer-backup.yml` | nightly 02:00 UTC | **3–5 min** | Database backup |
| 23 | `mutation-testing.yml` | weekly, manual, PR on specific paths | **5–30 min** | Stryker mutation testing |
| 24 | `gitleaks-reaudit.yml` | quarterly | **3–5 min** | Secrets baseline re-audit |
| 25 | `release.yml` | push main, manual | **2–3 min** | Changesets version PR |
| 26 | `semantic-release.yml` | after CI succeeds on main | **2–3 min** | Semantic release |
| 27 | `coordinate-release.yml` | manual | **1–2 min** | Cross-repo release coordination |
| 28 | `deploy.yml` | manual | **5–10 min** | Contract deployment |
| 29 | `mainnet-checklist-status.yml` | issue closed | **<1 min** | Checklist automation |
| 30 | `project-board.yml` | issues labeled, PR closed | **<1 min** | Project board automation |
| 31 | `sync-issues.yml` | issues labeled | **<1 min** | Cross-repo issue sync |
| 32 | `upptime.yml` | push main, **every 5 min** | **<1 min** | Uptime monitoring |

**Estimated concurrent peak for a typical PR** (assuming ~5 packages touched):

| Workflow | Duration |
|---------|----------|
| `ci.yml` (core pipeline) | 8–12 min |
| `coverage.yml` | 5–8 min |
| `codeql.yml` | 10–15 min |
| `snyk.yml` | 5–10 min |
| `knip.yml` | 3–5 min |
| `pr-title-lint.yml` | <1 min |
| `e2e-scope.yml` | <1 min |
| `sdk-bundle-size.yml` | 3–5 min |

**Total estimated wall-clock time**: ~15–20 min (parallel)  
**Total runner-minutes consumed**: ~40–60 min per PR

---

## 2. Identified redundancies

### 2.1 Duplicate test runs: `ci.yml` vs `coverage.yml`

Both `ci.yml` and `coverage.yml` run on **push to main and all PRs to main** with overlapping path filters:

- `ci.yml::node-tests` runs `notifications/templates.test.ts`
- `coverage.yml::notifications-coverage` runs the **same** `notifications/templates.test.ts` with coverage flags
- `ci.yml::core-test` runs all Node.js tests via `turbo run test` (including SDK, CLI, indexer)
- `coverage.yml` runs separate coverage jobs for SDK, CLI, indexer

**Impact**: Every push to main and every PR touching package code runs the same test suites twice — once for pass/fail and once for coverage. This doubles the runner-minutes for test execution.

**Recommendation**: Merge coverage collection into the `ci.yml::core-test` job by adding `--coverage` flags and a Codecov upload step. This eliminates ~5–8 min and ~20 runner-minutes per PR.

### 2.2 Inconsistent pnpm setup: `gitleaks` job in `ci.yml`

The `gitleaks` job in `ci.yml` uses raw `pnpm/action-setup@v4` + `actions/setup-node@v4` instead of the composite `./.github/actions/setup-pnpm` action that every other Node.js job uses.

**Impact**: No cache sharing with other jobs; slightly slower cold starts. Minor but inconsistent.

**Recommendation**: Replace the 3-step setup with a single `uses: ./.github/actions/setup-pnpm` step.

### 2.3 `gitleaks-reaudit.yml` and `indexer-backup.yml` use raw pnpm setup

Both use `pnpm/action-setup@v4` + `actions/setup-node@v4` + `pnpm install --frozen-lockfile` manually instead of the reusable cache workflow or the `setup-pnpm` composite action.

**Impact**: No pnpm store cache restoration; cold-start penalty on every run.

**Recommendation**: Use `setup-pnpm` composite action for consistency and cache benefits.

### 2.4 `coverage.yml` runs redundant `pnpm install` per package

Each coverage job (notifications, SDK, CLI, indexer) runs `pnpm install --frozen-lockfile` in its own working directory, even though the root lockfile and workspace already resolve all dependencies.

**Impact**: Unnecessary install steps that could be avoided with workspace-level installs.

**Recommendation**: Run a single `pnpm install` from the root (already done by the reusable cache) and remove per-package install steps.

### 2.5 `sdk-browser-tests.yml` doesn't use the reusable pnpm cache

Uses raw `pnpm/action-setup@v4` + `actions/setup-node@v4` instead of the reusable cache workflow.

**Impact**: No pnpm store cache sharing with other SDK-related jobs.

---

## 3. Scheduled workflow inventory

| Workflow | Schedule | Duration | Purpose |
|---------|----------|----------|---------|
| `e2e-nightly.yml` | Daily 00:00 UTC | 20–30 min | Full E2E test suite |
| `indexer-backup.yml` | Daily 02:00 UTC | 3–5 min | Database backup |
| `upptime.yml` | **Every 5 min** | <1 min | Uptime monitoring |
| `codeql.yml` | Weekly Sun 02:00 | 10–15 min | Security scanning |
| `snyk.yml` | Weekly Sun 03:00 | 5–10 min | Dependency scan |
| `docs-link-check.yml` | Weekly Mon 06:00 | 2–5 min | Broken link detection |
| `mutation-testing.yml` | Weekly Sun 06:00 | 5–30 min | Mutation testing |
| `gitleaks-reaudit.yml` | Quarterly | 3–5 min | Secrets baseline |

**Monthly scheduled runner cost estimate**: ~140–200 min  
- `upptime.yml`: ~8,640 runs/month × <1 min ≈ **~140 hr** (this is the dominant cost)
- `e2e-nightly.yml`: 30 runs × 25 min ≈ 12.5 hr
- Weekly jobs: 4 runs × 30 min ≈ 2 hr

**Note on `upptime.yml`**: Running every 5 minutes is very frequent. Consider reducing to every 15 or 30 minutes — most uptime monitors use 5-minute intervals but GitHub Actions has overhead per run.

---

## 4. Optimization opportunities (prioritized)

### High impact

1. **Merge coverage into `ci.yml::core-test`** — Eliminates duplicate test runs. Saves ~20–30 runner-minutes per PR and ~5–8 min wall-clock. Cross-reference: this would also simplify the `coverage.yml` path filter duplication.

2. **Add `oracle-service` to `ci.yml` path filters and `core-test`** — The `coverage.yml` already tracks `oracle-service/**` changes, but `ci.yml` doesn't filter for it in its `node-tests` job. This means oracle-service test regressions may only be caught in coverage, not in the required CI check.

### Medium impact

3. **Standardize pnpm setup across all workflows** — Replace raw `pnpm/action-setup` + `actions/setup-node` with `./.github/actions/setup-pnpm` in `gitleaks` (ci.yml), `gitleaks-reaudit.yml`, `indexer-backup.yml`, and `sdk-browser-tests.yml`. Ensures consistent cache behavior.

4. **Reduce `upptime.yml` frequency** — Every 5 minutes is aggressive for an uptime check. Consider 10 or 15 minutes, which still provides sub-15-min detection of outages.

5. **Share turbo cache between `ci.yml` and `coverage.yml`** — Both use turbo but with separate cache keys. Sharing the cache directory could avoid redundant builds when both workflows run on the same commit.

### Low impact

6. **Consider gating `codeql.yml` and `snyk.yml` on PR** — These are already path-independent and run on every PR to main. For PRs that only touch docs or CI config, these add ~15–25 min of unnecessary scanning. Adding path filters (excluding `docs/**`, `**/*.md`, `.github/workflows/**`) could save ~10 min per doc-only PR.

7. **Consolidate `e2e.yml` and `e2e-nightly.yml` Docker setup** — Both use `docker compose up -d stellar-node`. Consider extracting this into a reusable composite action if the setup is identical.

---

## 5. Summary

| Metric | Current | After optimizations (est.) |
|--------|---------|--------------------------|
| Total workflows | 35 (32 + 3 reusable) | 35 (no reduction needed) |
| Runner-minutes per typical PR | ~40–60 min | ~25–35 min |
| Wall-clock time per PR | ~15–20 min | ~12–15 min |
| Monthly scheduled runner cost | ~160 hr | ~150 hr (upptime reduction) |
| Duplicate test runs | 2× (ci + coverage) | 1× (merged) |

The largest single opportunity is merging coverage collection into the existing CI test pipeline, which would cut per-PR runner-minutes by ~30% without any loss of visibility.
