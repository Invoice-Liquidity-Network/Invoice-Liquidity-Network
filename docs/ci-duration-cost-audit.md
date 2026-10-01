# CI Duration & Cost Audit

## Summary

The highest-impact optimizations for this repository are the same ones already reflected in the main CI workflow: smaller change-detection scopes, a single pnpm store cache, and fail-fast concurrency control. These reduce unnecessary runners, avoid redundant package installs, and keep PR feedback loops short without widening the blast radius of the pipeline.

## Highest-Impact Optimizations

### 1. Scope jobs to the paths that actually changed

The root CI workflow uses a `changes` job with `dorny/paths-filter` so downstream jobs only run when their affected area changes. This avoids running Rust, Node, package, and release checks for unrelated edits.

### 2. Reuse a single pnpm store cache across jobs

The repo uses the shared `setup-pnpm` action to centralize cache setup and keep dependency installation fast across jobs. Reusing a populated pnpm store materially cuts both wall-clock time and GitHub Actions cost.

### 3. Fail fast and cancel redundant runs

The workflow applies `concurrency` with `cancel-in-progress: true` so a newer push cancels stale in-flight work. That reduces wasted build minutes on PR branches and shortens the average time to green on active branches.

## Operational Guardrails

- Keep the `changes` filter in sync with new services and packages.
- Add drift checks for workspace membership and compatibility matrices.
- Treat release automation as transactional: tag creation is tracked and a partial failure triggers rollback cleanup.

## Expected Outcome

These changes lower CI runtime for routine PRs and make the release path more deterministic, while preserving the protection checks that catch version drift and service map drift early.
