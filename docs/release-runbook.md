# Release Runbook

## Release model

This repository uses two complementary release mechanisms:

- **Changesets** remains the source of truth for versions and publishing of the individual workspace packages. It is responsible for package-specific version bumps, generated package changelogs, and coordinated multi-package releases.
- **semantic-release** manages the repository-level release metadata on `main`. It analyzes conventional commits, updates the root `CHANGELOG.md` and root package version, and creates the corresponding GitHub release.

The root package is private, so semantic-release is configured with the npm plugin for package version integration but does not publish the private root package. Workspace packages must continue to be released through the existing Changesets process. This avoids having two independent tools publish or version the same workspace packages.

## Automated release workflow

The `Semantic Release` workflow runs after the `CI` workflow completes successfully for `main`. It checks out the exact commit tested by CI and runs semantic-release with the repository `GITHUB_TOKEN`. The release commit is marked with `[skip ci]` to avoid an unnecessary CI cycle.

The workflow requires the following repository configuration:

- `GITHUB_TOKEN`: supplied automatically by GitHub Actions and used to create releases and commit release metadata.
- `NPM_TOKEN`: optional for the current private-root configuration; retain it if the root package becomes publishable in the future.

## Commit rules

Commit messages follow Conventional Commits:

- `BREAKING CHANGE` in the commit body, or a breaking `!` marker, produces a major release.
- `feat:` produces a minor release.
- `fix:` produces a patch release.
- Other commit types do not produce a release unless they contain a breaking change.

Examples:

```text
feat: add invoice filtering
fix: handle expired invoice status
feat!: remove the legacy invoice endpoint

BREAKING CHANGE: clients must use the v2 invoice endpoint
```

## Dry run

Run the release calculation locally without creating a tag, release, or commit:

```bash
npx semantic-release --dry-run
```

The dry run requires a complete git history and access to the repository's tags. It prints the calculated next version and the changelog notes that would be generated.

## Changelog verification

The changelog plugin updates the root `CHANGELOG.md`. Before approving a release-related change, verify that the dry-run output contains the expected version and that the generated sections contain the relevant `feat`, `fix`, and breaking-change entries.

Workspace package changelogs and package versions remain governed by Changesets. Do not manually edit generated release entries or create a second Changeset solely for the root semantic-release version.

## Recovery

If a release workflow fails before publishing, fix the cause and rerun the workflow from the failed `CI` workflow run when appropriate. If a GitHub release was created but the release commit was not pushed, inspect the repository state before rerunning to avoid duplicating release metadata.
