# Branch protection rules for `main`

This document describes the required GitHub branch protection settings for the `main` branch.
These settings are intended to preserve code quality, enforce review discipline, and protect the repository from unsafe history changes.

> **Last reconciled:** 2026-07-27 — verified against `.github/workflows/` files and known live settings.

## Required settings for `main`

### 1. Protect the `main` branch

- Enable branch protection on the `main` branch.
- Do not allow direct pushes to `main` unless through a protected merge path.

### 2. Require pull request reviews before merging

- Require pull request review before merging.
- Require at least **1 approving review**.
- Require review from **CODEOWNERS**.
  - This ensures the domain experts and maintainers identified in `.github/CODEOWNERS` must sign off on changes affecting owned files.
  - A `.github/CODEOWNERS` file is present and covers `sdk/`, `docs/`, `scripts/`, `.github/workflows/`, `SECURITY.md`, and a catch-all default.

### 3. Dismiss stale pull request approvals when new commits are pushed

- Enable **Dismiss stale pull request approvals when new commits are pushed**.
- Reason: ensures reviewers reapprove the PR after any code changes, keeping review status current.

### 4. Require linear history

- Enable **Require linear history**.
- Reason: prevents merge commits and ensures the `main` commit history remains easy to audit and backtrack.

### 5. Restrict force pushes

- Enable **Restrict force pushes** for `main`.
- Reason: prevents destructive rewrites of the branch history and preserves auditability.

### 6. Require status checks to pass before merging

Require the following GitHub Actions status checks on `main`:

#### Core quality gates (CI workflow — `ci.yml`)

These run on every PR and form the primary merge gate:

| Check name in GitHub | Job (`ci.yml`) | Runs on PRs? | Notes |
|---|---|---|---|
| `CI / Run Node.js tests` | `node-tests` | Yes | Always runs |
| `CI / Node.js coverage (≥80%)` | `node-coverage` | Yes | Always runs; enforces ≥80% coverage |
| `CI / Shared package type tests` | `shared-type-tests` | Yes | Always runs; `tsc` + `tsd` over `packages/shared` |
| `CI / Dependency license compliance check` | `license-compliance` | Yes | Always runs |
| `CI / Core · install` | `core-install` | Yes | Always runs |
| `CI / Core · format` | `core-format` | Yes | Always runs |

#### Backend-conditional gates (CI workflow — `ci.yml`)

These run only when `backend/**` or `.gitmodules` change (path-filtered):

| Check name in GitHub | Job (`ci.yml`) | Condition |
|---|---|---|
| `CI / Run tests` | `test` | Only if backend files changed |
| `CI / Build contract` | `build` | Only if backend files changed |
| `CI / Lint code` | `lint` | Only if backend files changed |
| `CI / SDK types in sync` | `sdk-types-sync` | Only if backend files changed |

> **Important:** Because these are path-filtered, they will be absent from checks on PRs that do not touch `backend/`. If branch protection requires them, GitHub's "require branches to be up to date" setting must be configured so that the PR inherits the result from a prior main merge, or these checks should be configured as *required when matching*, not unconditionally required.

#### Coverage workflow (`coverage.yml`)

| Check name in GitHub | Job | Runs on PRs? |
|---|---|---|
| `Coverage / Run tests and collect coverage` | `coverage` | Yes (always) |

#### Security scanning (`codeql.yml`)

| Check name in GitHub | Job | Runs on PRs? |
|---|---|---|
| `CodeQL Analysis / Analyze` | `analyze` | Yes (always) |

#### PR title validation (`pr-title-lint.yml`)

| Check name in GitHub | Job | Runs on PRs? |
|---|---|---|
| `PR title lint / lint` | `lint` | Yes (always) |

#### Dead code check (`knip.yml`)

| Check name in GitHub | Job | Runs on PRs? |
|---|---|---|
| `Dead Code Check / knip` | `knip` | Yes (always) |

#### Summary of recommended required checks

```
CI / Run Node.js tests
CI / Node.js coverage (≥80%)
CI / Shared package type tests
CI / Dependency license compliance check
CI / Core · install
CI / Core · format
Coverage / Run tests and collect coverage
CodeQL Analysis / Analyze
PR title lint / lint
Dead Code Check / knip
```

When backend files change, these additional checks should also pass:

```
CI / Run tests
CI / Build contract
CI / Lint code
CI / SDK types in sync
```

> Note: `E2E Nightly` is a scheduled workflow, not a required merge-time check. `E2E Integration` only runs when the `RUN_E2E` repository variable is set to `true`. Neither is typically included as a required PR status check.

## Checks that exist but are NOT required (and why)

| Workflow / Job | Why not required |
|---|---|
| `CI / Detect changed paths` | Internal utility job (no code quality gate) |
| `CI / Reusable pnpm cache` | Internal utility job |
| `CI / Reusable testnet health` | Internal utility job |
| `CI / Dependency version consistency` | Advisory — warns but does not fail on mismatches |
| `CI / Validate package.json consistency` | Could be required; currently not in branch protection |
| `CI / Guard against non-pnpm lockfiles` | Could be required; currently not in branch protection |
| `CI / Core · lint` | **Only runs on `push` events, not on PRs** — see gaps below |
| `CI / Core · type-check` | **Only runs on `push` events, not on PRs** — see gaps below |
| `CI / Core · test` | Depends on lint/type-check which are skipped on PRs |
| `CI / Core · build` | Depends on core-test which is skipped on PRs |
| `Changeset Check` | Path-filtered (`packages/**`, `sdk/**`); useful but not universally required |
| SDK checks (`sdk-api-docs`, `sdk-browser-tests`, `sdk-bundle-size`, `sdk-release/dry-run`) | Path-filtered to SDK changes only |
| `Scripts Release / Pack dry run` | Path-filtered to `packages/scripts/**` only |
| `Snyk Security Scanning` | Runs but may be a no-op if `SNYK_TOKEN` is unavailable |
| `CI / SDK testnet integration tests` | Only runs on push to main (not on PRs) |

## Gaps and flags for maintainer attention

### 1. Core lint and type-check are skipped on PRs

The `core-lint` and `core-type-check` jobs in `ci.yml` have `if: github.event_name == 'push'`, meaning they **only run on pushes to main** and are skipped on pull requests. This means:

- Linting and type-checking are not enforced during PR review
- `core-test` and `core-build` (which depend on them) are also effectively skipped on PRs
- This is a significant quality gap: PRs can introduce type errors or lint violations that are only caught after merge

**Recommended fix:** Remove or change the `if: github.event_name == 'push'` conditions on `core-lint` and `core-type-check` so they run on PRs as well. Then add these to the required checks:

```
CI / Core · lint
CI / Core · type-check
```

### 3. `Validate package.json consistency` and `Guard against non-pnpm lockfiles` could be required

These jobs run on every PR and catch real issues. They are currently not documented as required checks. Consider adding:

```
CI / Validate package.json consistency
CI / Guard against non-pnpm lockfiles
```

### 4. `Coverage` workflow is not documented in the required checks

The `coverage.yml` workflow runs its own Rust and Node.js coverage collection independently of the CI workflow. Its `Coverage / Run tests and collect coverage` check is a separate required check not listed in the previous version of this document.

## Additional notes

- The `.github/CODEOWNERS` file is present and covers `sdk/`, `docs/`, `scripts/`, `.github/workflows/`, `SECURITY.md`, and a catch-all default.
- If branch protection settings are changed in the GitHub UI, this document should be updated to match those settings.
- These settings are intended for `main` only; feature branches should follow the same PR workflow but do not require the same repository-level protection rules.

## Verification

- Verify the `main` branch protection settings in GitHub repository settings (Settings → Rules → Rulesets).
- Confirm that the required status checks listed above appear in the branch protection rule for `main`.
- Use `gh api repos/{owner}/{repo}/branches/main/protection` or the GitHub UI to audit live settings and compare against this document.
