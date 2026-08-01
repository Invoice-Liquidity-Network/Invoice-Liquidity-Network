# ILN Release Process

This document describes the process for releasing new versions of the Invoice Liquidity Network protocol across three coordinated repositories.

## Overview

ILN releases require coordinating changes across three repositories:

1. **ILN-Smart-Contract** — Rust/Soroban contracts (deployed to Stellar)
2. **Invoice-Liquidity-Network** — SDK, CLI, indexer, notifications (this repo)
3. **ILN-Frontend** — Next.js dApp

The correct release order is critical: smart contract deployment must complete before SDK updates, and SDK updates must complete before frontend deployment.

## Workflow Relationships

This repository contains four release-related workflows. The following diagram shows what triggers each, what they publish, and how they relate:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Release Workflows                                │
├──────────────────────┬──────────────────────────────────────────────────┤
│ Workflow             │ Trigger / Relationship                           │
├──────────────────────┼──────────────────────────────────────────────────┤
│ coordinate-release   │ workflow_dispatch (manual)                       │
│                      │ Orchestrator — does NOT call the other three     │
│                      │ via workflow_call. Tags repos, polls CI,         │
│                      │ and sends Discord notifications.                 │
├──────────────────────┼──────────────────────────────────────────────────┤
│ release.yml          │ push to main (changesets)                        │
│                      │ Opens "Version Packages" PR; merging it          │
│                      │ publishes ALL packages via changeset publish.    │
│                      │ Independent of coordinate-release.yml.           │
├──────────────────────┼──────────────────────────────────────────────────┤
│ sdk-release.yml      │ push of v* tags OR PR touching packages/sdk/     │
│                      │ Publishes @iln/sdk to npm with provenance;       │
│                      │ creates GitHub Release. Dry-run on PRs.          │
│                      │ Independent of the other three workflows.        │
├──────────────────────┼──────────────────────────────────────────────────┤
│ scripts-release.yml  │ push of @iln/scripts@* tags OR PR touching       │
│                      │ packages/scripts/                                 │
│                      │ Publishes @iln/scripts to npm with provenance;   │
│                      │ creates GitHub Release. Dry-run on PRs.          │
│                      │ Independent of the other three workflows.        │
└──────────────────────┴──────────────────────────────────────────────────┘
```

### Sequence Diagram — Automated Release (changesets path)

```
Developer          main branch          release.yml            npm
  │                    │                     │                   │
  │── merge PR ───────>│                     │                   │
  │                    │── push trigger ────>│                   │
  │                    │                     │── detect changesets
  │                    │                     │── open "Version    │
  │                    │                     │   Packages" PR     │
  │                    │<─────────────────── │                   │
  │                    │                     │                   │
  │── merge version PR>│                     │                   │
  │                    │── push trigger ────>│                   │
  │                    │                     │── changeset publish
  │                    │                     │── npm publish ────>│
  │                    │                     │── attest provenance│
```

### Sequence Diagram — Tag-based Release (sdk / scripts)

```
Developer          v* tag              sdk-release.yml         npm
  │                    │                     │                   │
  │── git push tag ───>│                     │                   │
  │                    │── push trigger ────>│                   │
  │                    │                     │── install + build  │
  │                    │                     │── test             │
  │                    │                     │── npm publish ────>│
  │                    │                     │── GitHub Release   │
```

### Sequence Diagram — Cross-Repo Coordinated Release

```
Maintainer       coordinate-release.yml     Smart Contract Repo    SDK Repo       Frontend Repo
  │                      │                         │                 │                │
  │── dispatch(v1.2.0)──>│                         │                 │                │
  │                      │── validate version       │                 │                │
  │                      │── tag v1.2.0 ───────────>│                 │                │
  │                      │── poll CI (≤10 min) ─────│                 │                │
  │                      │── update contract IDs ──────────────────> │                │
  │                      │── run SDK tests ─────────────────────────>│                │
  │                      │── tag sdk-v1.2.0 ────────────────────────>│                │
  │                      │── trigger frontend update ───────────────────────────────> │
  │                      │── poll frontend CI ───────────────────────────────────────│
  │                      │── tag frontend-v1.2.0 ───────────────────────────────────>│
  │                      │── Discord notification                    │                │
```

### Key Observations

- **No `workflow_call` dependencies exist** between the four workflows. Each is independently triggered.
- `coordinate-release.yml` is a **manual orchestrator** — it uses `gh api` and `gh workflow run` to tag repos and trigger CI, but does not invoke `release.yml`, `sdk-release.yml`, or `scripts-release.yml` as callable workflows.
- `release.yml` (changesets) and `sdk-release.yml` (tag-based) can **both publish `@iln/sdk`** depending on the release path chosen. This is not a bug — they serve different release strategies (changesets workflow vs. manual tag push). However, teams should pick one strategy to avoid duplicate publishes.
- `scripts-release.yml` exclusively publishes `@iln/scripts` and has no overlap with the other workflows.

## Release Order

### Phase 1: Smart Contract (ILN-Smart-Contract)

1. Deploy new contract version to Stellar testnet/mainnet
2. Tag the contract repository with the version (e.g., `v1.2.0`)
3. CI verifies deployment and generates new contract IDs

### Phase 2: SDK (Invoice-Liquidity-Network)

1. Update contract IDs in SDK based on new deployment
2. Run full SDK test suite
3. Tag SDK release with `sdk-v1.2.0`
4. Publish SDK to npm if applicable

### Phase 3: Frontend (ILN-Frontend)

1. Update SDK dependency in frontend package.json
2. Run frontend CI (build, linting, tests)
3. Tag frontend release with `frontend-v1.2.0`

## Automated Release Workflow

The `.github/workflows/coordinate-release.yml` workflow automates this process.

### Triggering a Release

1. Go to the main repository: [Invoice-Liquidity-Network](https://github.com/Songu3020/Invoice-Liquidity-Network)
2. Navigate to **Actions** → **Coordinate Cross-Repo Release**
3. Click **Run workflow**
4. Fill in the required inputs:
   - **Version**: Semantic version (e.g., `v1.2.0`)
   - **Dry run** (optional): Check to test without making changes
   - **Discord webhook** (optional): Paste webhook URL for notifications

### Workflow Inputs

```yaml
version:
  description: Release version in semantic format (e.g., v1.2.0)
  required: true
  example: v1.2.0

dry_run:
  description: Skip actual tagging, just simulate the process
  required: false
  default: false

discord_webhook:
  description: Discord webhook URL for release notification
  required: false
  example: https://discordapp.com/api/webhooks/...
```

### Workflow Steps

The automated workflow performs these steps in sequence:

1. **Validate version format** — Ensures version follows semantic versioning
2. **Tag smart contract repo** — Creates a git tag in ILN-Smart-Contract
3. **Wait for smart contract CI** — Polls GitHub Actions until deployment completes
4. **Update SDK contract IDs** — Fetches new contract IDs and updates SDK
5. **Run SDK tests** — Verifies SDK still works with new contract IDs
6. **Tag SDK release** — Creates a git tag in Invoice-Liquidity-Network
7. **Update frontend SDK version** — Updates package.json in ILN-Frontend
8. **Wait for frontend CI** — Polls GitHub Actions until frontend CI completes
9. **Tag frontend release** — Creates a git tag in ILN-Frontend
10. **Send Discord notification** — Posts release summary to Discord (optional)

## Manual Release Process (If Workflow Fails)

If the automated workflow encounters issues, you can perform a manual release:

### 1. Smart Contract Release

```bash
# In ILN-Smart-Contract repo
git tag v1.2.0
git push origin v1.2.0

# Wait for CI to complete and verify contract IDs
# Document new contract IDs from CI logs
```

### 2. SDK Release

```bash
# In Invoice-Liquidity-Network repo
# Update contract IDs in sdk/src/config.ts or similar
# Update SDK version in sdk/package.json

npm ci
npm run test
npm run build

git add .
git commit -m "chore(sdk): update contract IDs for v1.2.0"
git tag sdk-v1.2.0
git push origin main sdk-v1.2.0

# Optionally publish to npm
npm publish --workspace=sdk
```

### 3. Frontend Release

```bash
# In ILN-Frontend repo
# Update SDK dependency
npm install @invoice-liquidity/sdk@latest

npm run test
npm run build

git add .
git commit -m "chore(frontend): update SDK to v1.2.0"
git tag frontend-v1.2.0
git push origin main frontend-v1.2.0
```

## Dry Run Mode

Use dry-run mode to test the entire workflow without making actual changes:

1. Run the workflow with:
   - **Version**: `v1.2.0`
   - **Dry run**: ✓ (checked)

The workflow will log all steps it would perform but skip tagging and pushing changes.

## Environment Setup

To enable the automated workflow, ensure:

### Repository Secrets

Set these secrets in the main repository settings:

- `GITHUB_TOKEN` — Already available via `secrets.GITHUB_TOKEN`
- No additional secrets required for basic functionality

### Discord Webhook (Optional)

To receive release notifications:

1. Create a Discord server/channel (if not exists)
2. Set up a webhook in Discord channel settings
3. Copy the webhook URL
4. Paste it when running the workflow in the "Discord webhook URL" input

### Cross-Repo Access

The workflow uses the GitHub token to access sibling repositories. Ensure:

- All three repositories are in the same organization
- The token has sufficient permissions (typically default for same-org workflows)

## Rollback

If a release fails or needs to be rolled back:

### Delete tags (if incorrectly tagged)

```bash
git tag -d v1.2.0
git push origin --delete v1.2.0
```

### Revert SDK/Frontend changes

```bash
# If you need to revert to previous SDK version in frontend
npm install @invoice-liquidity/sdk@<previous-version>
git add package.json package-lock.json
git commit -m "chore: revert SDK to previous version"
git push origin main
```

## Troubleshooting

### Workflow timeout

- The workflow waits up to 10 minutes for dependent CI to complete
- If CI is slow, extend the polling interval in the workflow file

### Contract ID updates not reflected

- Verify that contract IDs are correctly exported from smart contract CI
- Check that SDK files are updated in the correct locations (typically `sdk/src/config.ts` or similar)

### Frontend dependency resolution fails

- Check that SDK package.json version is published to npm before frontend tries to install
- Manually run `npm install` in frontend after SDK release tag is created

### Discord notification fails

- Verify webhook URL is correct
- Check Discord channel permissions for the webhook
- If webhook is invalid, the workflow will continue but log a warning

## Manual Triggers (`workflow_dispatch`)

All deploy and release workflows support manual triggering from the GitHub UI:

| Workflow | Has `workflow_dispatch` | Inputs |
| -------- | ---------------------- | ------ |
| `deploy.yml` | Yes | `network` (testnet/mainnet), `dry_run` |
| `docs-deploy.yml` | Yes | None |
| `coordinate-release.yml` | Yes | `version`, `dry_run`, `discord_webhook` |
| `release.yml` | Yes | None (triggers changeset flow) |
| `sdk-release.yml` | Yes | None (requires `v*` tag ref) |
| `scripts-release.yml` | Yes | None (requires `@iln/scripts@*` tag ref) |

### When to use manual triggers

- **Re-deploy docs** after a failed automatic deployment: run `docs-deploy.yml` → "Run workflow".
- **Re-cut a release** after a failed publish: run `release.yml` → "Run workflow" on `main`, or push a new tag for `sdk-release.yml` / `scripts-release.yml`.
- **Dry-run a cross-repo release**: run `coordinate-release.yml` with `dry_run: true`.

## Future Improvements

Potential enhancements to the release process:

- [ ] Automated changelog generation based on commits since last release
- [ ] Automatic npm publish after SDK tag creation
- [ ] Slack notification alternative to Discord
- [ ] Release notes template population
- [ ] Mainnet vs testnet release coordination
- [ ] Automated frontend deploy to staging/production

## NPM Scope Ownership and Publishing Policy

### Registered Scopes

The project publishes npm packages under two scopes:

| Scope | Owner | 2FA Required |
|---|---|---|
| `@iln` | Invoice Liquidity Network maintainers | Yes |
| `@invoice-liquidity` | Invoice Liquidity Network maintainers | Yes |

Both scopes must be registered under the project's control. **Maintainers must
verify scope ownership and 2FA on the publishing account before any publish
workflow runs.** Unclaimed or poorly-controlled scopes create a
dependency-confusion/typosquatting risk.

### Unpublished-but-referenced Packages

The following internal packages are referenced in the monorepo but are not yet
published to npm. They MUST NOT be installed from npm by external consumers;
they resolve from the workspace instead.

| Local Name | Published Name | Status |
|---|---|---|
| `packages/cli` | `@iln/cli` | Unpublished |
| `packages/test-utils` | `@iln/test-utils` | Unpublished |
| `packages/scripts` | `@iln/scripts` | Unpublished |
| `packages/sdk` | `@iln/sdk-next` | Unpublished |
| `packages/mock-backend` | `@iln/mock-backend` | Unpublished |
| `packages/indexer` | `@iln/indexer` | Unpublished |
| `packages/invoice-sdk` | `@iln/invoice-sdk` | Unpublished |
| `packages/eslint-config` | `@iln/eslint-config` | Unpublished |
| `packages/upgrade-tests` | `@iln/upgrade-tests` | Unpublished |
| `packages/shared` | `@iln/shared` | Unpublished |
| `packages/react` | `@iln/react` | Unpublished |
| `packages/opentelemetry` | `@iln/opentelemetry` | Unpublished |
| `sdk/` | `@iln/sdk` | Published via `sdk-release.yml` |
| `cli/` | `@invoice-liquidity/cli` | Unpublished |
| `docs/` | `@invoice-liquidity/docs` | Unpublished |
| `indexer/` | `iln-indexer` | Unpublished |
| `notifications/` | `iln-notifications` | Unpublished |

> **Action required:** Add a placeholders publish task to reserve these names
> if the project's standard practice is to prevent squatting. Coordinate with a
> maintainer who has npm registry access.

### Verification Checklist (per release)

1. Confirm `@iln` and `@invoice-liquidity` scopes are owned by the project org.
2. Confirm the npm automation token used in CI has `2FA-required` publish access.
3. Review the unpublished-but-referenced table above and reserve any new names
   before they appear in a public release.
