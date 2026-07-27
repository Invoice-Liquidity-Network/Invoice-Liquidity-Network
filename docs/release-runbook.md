# Release Runbook

This document describes how releases are managed in the Invoice Liquidity Network monorepo.

## Overview

Releases are fully automated via [semantic-release](https://semantic-release.gitbook.io/). On every push to `main` where CI passes, semantic-release analyses the commit history since the last tag and, if there are releasable commits, it:

1. Determines the next version (major / minor / patch).
2. Generates release notes from commit messages.
3. Appends the release notes to `CHANGELOG.md`.
4. Creates a git tag and a GitHub Release.
5. Commits the updated `CHANGELOG.md` back to `main` with a `[skip ci]` tag to avoid triggering another run.

No manual version bumping or changelog editing is required.

---

## Commit Convention

This project uses the [Conventional Commits](https://www.conventionalcommits.org/) specification, enforced at commit time by commitlint + Husky.

| Commit prefix | Version bump |
|---------------|-------------|
| `BREAKING CHANGE:` in footer, or `!` after type | **major** |
| `feat:` | **minor** |
| `fix:`, `perf:`, `revert:` | **patch** |
| `chore:`, `docs:`, `test:`, `ci:`, `style:`, `refactor:` | no release |

### Examples

```
feat: add multi-token support for EURC
fix: prevent dust attack via minimum invoice amount
feat!: remove deprecated submit_invoice_v1 endpoint

BREAKING CHANGE: submit_invoice_v1 has been removed. Use submit_invoice_v2.
```

---

## GitHub Actions Workflow

The workflow lives at `.github/workflows/release.yml`. It triggers on `workflow_run` completion of the **CI** workflow on `main`, so a release only runs after all CI jobs pass.

### Required Secrets

| Secret | Purpose |
|--------|---------|
| `GITHUB_TOKEN` | Automatically provided. Used to create GitHub Releases and push the changelog commit. |
| `NPM_TOKEN` | Required by `@semantic-release/npm` for registry authentication even though `npmPublish` is `false`. Set to any valid npm token (or a dummy value if no npm publishing is ever planned). |

Set `NPM_TOKEN` under **Settings → Secrets and variables → Actions**.

---

## Dry Run (Local)

Run semantic-release in dry-run mode to preview what the next release would be without making any changes:

```bash
# Install deps first if you haven't
pnpm install

# Dry run — reads commits, prints the next version and release notes
GITHUB_TOKEN=<your-pat> pnpm exec semantic-release --dry-run
```

> The `GITHUB_TOKEN` must have `repo` scope. A fine-grained PAT scoped to this repository works.

You can also verify the commit-analyzer output in isolation:

```bash
pnpm exec semantic-release --dry-run --no-ci 2>&1 | grep -E "(nextRelease|No release)"
```

---

## Changesets Compatibility

This repo uses **semantic-release** at the root level for mono-repo release coordination; it does **not** use [Changesets](https://github.com/changesets/changesets).

The two tools are philosophically similar but incompatible in the same workflow:

| | semantic-release | Changesets |
|---|---|---|
| Version source | Commit messages (conventional commits) | Manually authored `.changeset/*.md` files |
| CHANGELOG | Auto-generated from commits | Auto-generated from changeset files |
| Individual package publishing | Via `@semantic-release/exec` per-package | Native support (`changeset publish`) |

**Chosen approach — semantic-release only:**

- The root package is `private`, so publishing is skipped (`npmPublish: false`).
- `sdk` and `cli` are published separately and managed by their own `package.json` version fields. When a release is tagged at the root, maintainers manually bump the sub-package versions and publish via `pnpm --filter @invoice-liquidity/sdk publish` (or set up per-package release jobs).
- If full automated per-package publishing is needed in the future, migrate to Changesets or add `@semantic-release/exec` steps per workspace package.

There is **no `.changeset/` directory** in this repo; do not initialise Changesets alongside semantic-release.

---

## Triggering a Release Manually

Releases are triggered automatically by commits to `main`. To force one outside the normal flow:

```bash
# From your local main branch, with a releasable commit present:
GITHUB_TOKEN=<pat> pnpm exec semantic-release
```

Or re-run the **Release** workflow from the GitHub Actions UI after a successful CI run.

---

## Skipping a Release

Commits that should not trigger a release use types outside the release matrix (`chore:`, `docs:`, `test:`, `ci:`, `style:`, `refactor:`), or include `[skip release]` anywhere in the commit body.

The `[skip ci]` tag on the changelog commit created by semantic-release itself prevents a release loop.
