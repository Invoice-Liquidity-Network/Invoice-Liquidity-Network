# ILN Release Process

This document describes the process for releasing new versions of the Invoice Liquidity Network protocol across coordinated repositories.

## Overview

ILN releases require coordinating changes across the following repositories and packages:

1. **ILN-Smart-Contract** — Rust/Soroban contracts (deployed to Stellar)
2. **Invoice-Liquidity-Network (SDK)** — `@invoice-liquidity/sdk` (`sdk/`) and `@iln/sdk-next` (`packages/sdk/`)
3. **Invoice-Liquidity-Network (CLI)** — `@invoice-liquidity/cli` (`cli/`)
4. **Invoice-Liquidity-Network (Indexer)** — `@iln/indexer` (`packages/indexer/`)
5. **Invoice-Liquidity-Network (Notifications)** — `@iln/notifications` (`notifications/`)
6. **ILN-Frontend** — Next.js dApp (`ILN-Frontend`)

The correct release order is critical: smart contract deployment must complete before SDK updates, and SDK updates must complete before frontend and dependent service deployments.

## Release Order

### Phase 1: Smart Contract (ILN-Smart-Contract)

1. Deploy new contract version to Stellar testnet/mainnet
2. Tag the contract repository with the version (e.g., `v1.2.0`)
3. CI verifies deployment and generates new contract IDs

### Phase 2: Shared Packages (Invoice-Liquidity-Network repo)

1. Update contract IDs in SDK based on new deployment
2. Update SDK version if needed
3. Run full SDK test suite (`pnpm test` from package directory)
4. Run CLI tests (`pnpm test` from `cli/` directory)
5. Run indexer tests (`pnpm test` from `packages/indexer/` directory)
6. Run notifications tests (`pnpm test` from `notifications/` directory)
7. Tag releases for each published package

### Phase 3: Frontend (ILN-Frontend)

1. Update SDK dependency in frontend package.json
2. Run frontend CI (build, linting, tests)
3. Tag frontend release

## Automated Release Workflow

The `.github/workflows/coordinate-release.yml` workflow automates this process.

### Triggering a Release

1. Go to the main repository: [Invoice-Liquidity-Network](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network)
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
# In Invoice-Liquidity-Network repo, sdk/ directory
# Update contract IDs in sdk/src/config.ts or similar
# Update SDK version in sdk/package.json

pnpm install
pnpm test
pnpm build

git add .
git commit -m "chore(sdk): update contract IDs for v1.2.0"
git tag v1.2.0
git push origin main v1.2.0

# Optionally publish to npm
pnpm publish --provenance --access public
```

### 3. CLI Release

```bash
# In Invoice-Liquidity-Network repo, cli/ directory
pnpm install
pnpm test
pnpm build

git add .
git commit -m "chore(cli): update contract IDs for v1.2.0"
git tag v1.2.0
git push origin main v1.2.0

# Optionally publish to npm
pnpm publish --provenance --access public
```

### 4. Indexer Release

```bash
# In Invoice-Liquidity-Network repo, packages/indexer/ directory
pnpm install
pnpm test
pnpm build

git add .
git commit -m "chore(indexer): update contract IDs for v1.2.0"
git tag v1.2.0
git push origin main v1.2.0

# Optionally publish to npm
pnpm publish --provenance --access public
```

### 5. Notifications Release

```bash
# In Invoice-Liquidity-Network repo, notifications/ directory
pnpm install
pnpm test
pnpm build

git add .
git commit -m "chore(notifications): update contract IDs for v1.2.0"
git tag v1.2.0
git push origin main v1.2.0

# Optionally publish to npm
pnpm publish --provenance --access public
```

### 6. Frontend Release

```bash
# In ILN-Frontend repo
# Update SDK dependency
pnpm install @invoice-liquidity/sdk@latest

pnpm test
pnpm build

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
- `NPM_TOKEN` — npm automation token with publish rights (for npm publish steps)
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
pnpm install @invoice-liquidity/sdk@<previous-version>
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
- Manually run `pnpm install` in frontend after SDK release tag is created

### Discord notification fails

- Verify webhook URL is correct
- Check Discord channel permissions for the webhook
- If webhook is invalid, the workflow will continue but log a warning

## Future Improvements

Potential enhancements to the release process:

- [ ] Automated changelog generation based on commits since last release
- [ ] Automatic npm publish after SDK tag creation
- [ ] Slack notification alternative to Discord
- [ ] Release notes template population
- [ ] Mainnet vs testnet release coordination
- [ ] Automated frontend deploy to staging/production
- [ ] Per-package release tags for CLI, indexer, and notifications
- [ ] Coordination with ILN-Frontend for all shared package updates
