# Release Runbook

This document explains the dual-tool release strategy used in this monorepo.

---

## Two tools, two responsibilities

| Concern | Tool | Scope |
|---|---|---|
| Root repo git tag + GitHub Release + `CHANGELOG.md` | **semantic-release** | Monorepo root |
| Per-package `version` bumps + npm publish | **Changesets** | `packages/*`, `sdk/` |

They do not conflict: semantic-release reads git commits and never touches package versions; Changesets reads changeset files and never creates repo-level git tags.

---

## How semantic-release works here

### Trigger

`semantic-release.yml` runs after the CI workflow completes successfully on `main` (via `workflow_run`). It will no-op if no releasable commits are found.

### Version rules (`.releaserc.json`)

| Commit prefix / footer | Version bump |
|---|---|
| `BREAKING CHANGE:` in footer, or `!` after type | **major** |
| `feat:` | **minor** |
| `fix:`, `perf:`, `revert:` | **patch** |
| `docs:`, `chore:`, `ci:`, `build:`, `test:`, `style:`, `refactor:` | no release |

### What it produces

1. Calculates next semver from commits since the last tag.
2. Updates `CHANGELOG.md` at the repo root.
3. Updates the root `package.json` version field (publish is disabled — root is private).
4. Creates a git tag (e.g. `v1.2.0`) and pushes it.
5. Creates a GitHub Release with auto-generated notes.

### Required secrets

| Secret | Purpose |
|---|---|
| `GITHUB_TOKEN` | Tag, release, commit back changelog |
| `NPM_TOKEN` | Present but publish is disabled for root; still required by `@semantic-release/npm` |

---

## How Changesets works here

1. During development, contributors run `pnpm changeset` and commit the generated `.changeset/*.md` file alongside their PR.
2. The `changeset-check.yml` workflow enforces changeset presence on PRs that touch packages.
3. When changesets land on `main`, `release.yml` (using `changesets/action@v1`) opens a **"Version Packages"** PR that bumps `version` fields and updates per-package changelogs.
4. Merging that PR triggers `changesets/action` to publish to npm with provenance attestation.

---

## Dry-run (local testing)

```bash
# Preview what semantic-release would do without writing anything
GITHUB_TOKEN=<your_PAT> pnpm exec semantic-release --dry-run
```

You need a GitHub personal access token with `repo` scope.

---

## Compatibility notes

- semantic-release tags the **monorepo** (e.g. `v1.2.0`). Changesets tags individual packages (e.g. `@iln/sdk@0.5.0`). These tag namespaces do not collide.
- The `[skip ci]` trailer in semantic-release's commit-back message prevents an infinite CI loop.
- `concurrency: semantic-release` ensures only one release runs at a time.
- `@semantic-release/npm` is included with `npmPublish: false` so the root `package.json` version is kept in sync with the git tag without publishing.

---

## Adding a new releasable type

Edit the `releaseRules` array in `.releaserc.json`:

```json
{ "type": "refactor", "release": "patch" }
```

Commit the change with a `chore:` prefix (no release triggered).

---

## Troubleshooting

**No release created after merging to main**
- Check that at least one commit since the last tag starts with `feat:`, `fix:`, `perf:`, `revert:`, or contains `BREAKING CHANGE`.
- Run `git log <last-tag>..HEAD --oneline` to inspect commits.

**"ENOGHTOKEN" / permissions error**
- Verify `GITHUB_TOKEN` has `contents: write` (granted by the workflow's `permissions` block).
- Branch protection "Allow GitHub Actions to create and approve pull requests" must be enabled.

**Semantic-release and Changesets releasing at the same time**
- They operate independently and are safe to run concurrently. semantic-release touches `CHANGELOG.md` and the root version; Changesets touches per-package changelogs and package versions.
