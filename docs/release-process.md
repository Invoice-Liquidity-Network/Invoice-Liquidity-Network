# Release process

This runbook captures the recommended ILN release workflow for contract, SDK, and frontend changes. It is intended to make releases predictable, verifiable, and safe.

## Scope

This document covers:

- Pre-release checklist
- Release sequence and ordering
- Post-release smoke tests
- Rollback procedures for each component
- Version numbering policy
- Release communication and GitHub Release notes template

## Version numbering policy

ILN follows Semantic Versioning (semver) for all published packages and component releases.

- `MAJOR.MINOR.PATCH`
- `PATCH` for backward-compatible bug fixes
- `MINOR` for backward-compatible feature additions and improvements
- `MAJOR` for breaking API or protocol changes

### Contract version policy

The ILN smart contract is the source of protocol truth. Any contract upgrade that changes transaction entry points, data formats, or behavior in a way that is not backward-compatible should be treated as a major version bump.

- Contract upgrades that preserve the existing interface may still require careful deployment coordination, but they should be documented as a contract version change.
- If the upgrade changes the on-chain contract ABI, `MAJOR` must be bumped.
- The SDK and frontend should track contract compatibility and may also need a major bump when the contract interface changes.

### SDK and frontend version policy

- SDK releases follow semver based on API compatibility.
- Frontend releases follow semver based on visible feature or behavior changes.
- When a contract upgrade requires an SDK interface change, plan the SDK release immediately after the contract release.

## Pre-release checklist

Before starting a release, confirm the following:

### Code and tests

- [ ] All automated tests pass on `main` and on the release branch.
- [ ] Contract tests pass, including unit tests and any integration tests for contract behavior.
- [ ] SDK tests and type generation pass.
- [ ] Frontend tests and smoke tests pass.

### Documentation and changelog

- [ ] `CHANGELOG.md` is updated with all release notes for the planned version.
- [ ] Any public API, SDK, or contract interface changes are documented in the appropriate docs files.
- [ ] Release notes draft is prepared for GitHub Release.

### Issue triage and approvals

- [ ] No open critical or blocker issues remain for the release scope.
- [ ] All release-critical PRs are approved and merged.
- [ ] The release branch is up to date with `main` and CI has passed.

### Dependencies and compatibility

- [ ] Contract spec generation has been run and the SDK type files are regenerated if needed.
- [ ] Any dependency updates included in the release are verified.
- [ ] Upgrade notes are prepared for developers and integrators.

## Release sequence

ILN release ordering is important because downstream components depend on upstream artifacts.

### 1. Contract release

1. Build the contract for the correct target, for example:
   - `cargo build --target wasm32v1-none --release`
2. Run contract unit tests and integration tests.
3. Generate the contract spec JSON if required for SDK type generation:
   - `stellar contract info --wasm target/wasm32v1-none/release/*.wasm --output-format json > target/spec.json`
4. Verify the contract is ready for deployment and review the package version.
5. Deploy or publish the new contract release according to the deployment process in place.

### 2. SDK release

1. Regenerate SDK types for contract changes:
   - `pnpm generate:types`
2. Run SDK tests and validate the generated types.
3. Update the SDK package version if the public API changed.
4. Publish the SDK package or create the pull request that will release it.
5. Confirm the new SDK version is available before advancing.

### 3. Frontend release

1. Update the frontend to use the new SDK version and any contract changes.
2. Run frontend build and smoke tests.
3. Publish the frontend release to the hosting environment.
4. Confirm that the deployed frontend is using the expected dependencies.

### Why this order?

- Contract changes are the foundation of the protocol.
- The SDK must be updated after the contract so it can expose the correct types and interface.
- The frontend depends on the SDK and should be released last to ensure compatibility.

## Post-release smoke test

After release, validate the system with a focused smoke test.

### Smoke test checklist

- [ ] Basic contract flows work as expected.
- [ ] SDK calls succeed against the deployed contract.
- [ ] Frontend UI behavior is correct for the release flows.
- [ ] No regressions appear in the primary user journey.
- [ ] Published package versions and release metadata are correct.

### Recommended validation steps

- Run the core happy path for a contract interaction.
- Test SDK examples that depend on the updated contract.
- Open the frontend and verify the main release flows.
- Confirm release notes and documentation links are published.

## Rollback procedures

A rollback path should be defined before release. Use the following fallback plans when needed.

### Contract rollback

- If the contract deployment is invalid, revert to the last known good contract version or redeploy the previous release.
- Update any runtime configuration that points to the contract address.
- Coordinate with SDK and frontend teams to restore compatibility with the prior contract.
- Communicate a contract rollback and the impact to users and integrators.

### SDK rollback

- If the published SDK is broken, publish a patch release that restores the last working public API.
- Avoid relying on package unpublish unless the registry policy permits it.
- Notify integrators of the rollback and provide the restored SDK version.

### Frontend rollback

- Roll back the frontend deployment to the previous build in the hosting environment.
- If a fast rollback is not available, deploy a hotfix branch with the prior stable frontend version.
- Confirm the rollback removes the broken behavior and restores the previous production state.

## Release communication

A release should be communicated clearly through multiple channels.

### GitHub Release notes

- Publish a GitHub Release for each version.
- Use the release notes template below.
- Confirm the release notes are linked from `CHANGELOG.md` if appropriate.

### Discord announcement

- Announce the release in the project community channel.
- Include the release version, high-level changes, and any links to migration or docs.

### Docs update

- Link the new release to relevant documentation pages.
- Update any reference docs that depend on the new contract or SDK behavior.
- Confirm the public docs site or docs repo reflects the latest version.

## GitHub Release notes template

```
# Release vX.Y.Z

## Summary

A short overview of what changed in this release.

## What’s included

- Feature or improvement A
- Fix for issue B
- Contract/SDK/frontend compatibility notes

## Upgrade notes

- Required steps for integrators
- Contract address or config changes
- SDK version that should be used

## Verification

- Smoke test checklist passed
- Deployment verified in production or staging

## Notes

- Known limitations
- Rollback plan if needed
```

## Related references

- `CHANGELOG.md`
- `CONTRIBUTING.md`
- `docs/ci-cd.md`
