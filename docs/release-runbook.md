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

## Dry run and changelog verification (scripted — issue #1096)

Both used to be manual: run `npx semantic-release --dry-run` locally, then eyeball
the output for the expected version and `feat`/`fix`/breaking-change sections. This is
now scripted as a required step in `.github/workflows/semantic-release.yml`, before
the real run:

```bash
pnpm release:verify-dry-run
```

`scripts/verify-release-dry-run.mjs` runs the dry run, then:

- Passes if a version was computed **and** changelog-shaped content is present.
- Passes if nothing is pending release (no relevant commits since the last release).
- **Fails** if a version was computed but no changelog content was found (the
  scenario the old manual step existed to catch — e.g. a `.releaserc.json`
  changelog-plugin misconfiguration).
- Fails open (passes, with a note) if semantic-release's own log wording doesn't
  match what the parser expects, rather than blocking a release over a cosmetic
  format change it can't confidently interpret. A real error running
  semantic-release (non-zero exit) always fails the check.

You can still run it locally the same way before pushing a release-affecting change:

```bash
pnpm release:verify-dry-run
```

Workspace package changelogs and package versions remain governed by Changesets. Do not manually edit generated release entries or create a second Changeset solely for the root semantic-release version.

## Release audit log (issue #1096)

Every run of `semantic-release.yml` and `release.yml` (Changesets) appends a
structured entry — actor, action, outcome, ref, and version when applicable —
to `release-audit/log.jsonl`, committed back to `main` with `[skip ci]` by the
workflow itself. See [release-audit/README.md](../release-audit/README.md) for
the format and how to read it. This is the "who/what/when" record for
post-release review; it does not replace the GitHub Actions run logs, it makes
their outcome greppable without opening Actions.

## Recovery

Most of the release path above is now scripted and self-verifying. What's left
genuinely requires a human, and is kept deliberately short:

1. **Diagnosing *why* a release workflow failed.** The dry-run/audit-log
   scripts detect and record *that* something went wrong; root-causing a
   failed `npm publish`, an expired token, or a merge conflict in the
   Changesets "Version Packages" PR requires reading the failure and deciding
   what to do. This is deliberately not automated: blindly retrying a failed
   publish risks a duplicate or partial release, which is worse than a
   delayed one.
2. **Deciding whether to rerun vs. roll forward.** If a GitHub release was
   created but the release commit failed to push (or vice versa), inspect the
   repository state before rerunning — the workflow does not currently detect
   or self-heal a partial success, to avoid duplicating release metadata or
   double-publishing.
3. **Recording the resolution.** Once you've manually fixed and re-run
   (or decided not to), log it so the audit trail stays complete:
   ```bash
   node scripts/release-audit-log.mjs --action manual-recovery --actor <you> \
     --ref <sha> --outcome success --notes "what happened and what you did"
   ```

Nothing else in the release path requires human judgment: version calculation,
changelog generation, dry-run verification, npm publish, provenance
attestation, GitHub Release creation, and audit logging are all scripted and
run unattended on every push to `main`.
