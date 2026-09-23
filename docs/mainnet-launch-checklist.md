# Mainnet Launch Checklist

This checklist tracks the requirements that must be complete before ILN mainnet deployment. Each item has an owner, status, and link to the issue, PR, or document that proves completion.

Status values:

- `Not started`
- `In progress`
- `Blocked`
- `Done`

## Security

| Item | Description | Owner | Status | Link |
| --- | --- | --- | --- | --- |
| External security audit | Complete an external audit of Soroban contracts, upgrade controls, SDK signing paths, indexer APIs, and notification webhooks. | Security lead | Done | [Auditor Onboarding Guide](./auditor-onboarding.md) |
| Coverage thresholds met | Confirm contract, SDK, CLI, indexer, and notifications coverage thresholds pass in CI before release branch freeze. | QA lead | Done | [Coverage workflow](../.github/workflows/coverage.yml) |
| Fuzz tests run | Run fuzz or property-based tests for invoice lifecycle, XDR encoding, amount math, and settlement state transitions. | Protocol lead | Done | [`sdk/src/xdr.test.ts`](../sdk/src/xdr.test.ts) and [`packages/sdk/src/xdr.test.ts`](../packages/sdk/src/xdr.test.ts) |
| Unified security policy | Publish ecosystem-wide reporting, severity, safe-harbour, and response timeline policy across all repositories. | Security lead | Done | [`SECURITY.md`](../SECURITY.md) |
| Bug bounty program launched | Design and launch pre-mainnet bug bounty program defining scope, severity taxonomy, reward tiers, and triage SLA. | Security lead | Done | [Bug Bounty Program](./bug-bounty.md) |

## Contracts

| Item | Description | Owner | Status | Link |
| --- | --- | --- | --- | --- |
| Upgrade path tested | Prove contract upgrade flow works on a local network and testnet without storage collision or authorization regressions. | Protocol lead | Done | [`packages/upgrade-tests`](../packages/upgrade-tests) |
| Multi-sig admin configured | Configure production admin keys with multi-sig, quorum, timelock, and emergency response procedures. | Governance lead | Done | [Governance guide](governance-guide.md#production-multi-sig-admin-configuration) |
| Circuit breaker tested | Exercise pause and recovery paths for funding, settlement, indexing, and notification delivery. | Security lead | Done | [Emergency pause rehearsal](emergency-pause-rehearsal.md) ([#879](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/879)) |
| Mainnet deployment dry run | Run deployment automation against a non-production target and record contract IDs, asset IDs, and rollback notes. | Release lead | Done | [Dry run record](mainnet-deployment-dry-run.md) ([#877](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/877)) |

## Infrastructure

| Item | Description | Owner | Status | Link |
| --- | --- | --- | --- | --- |
| Indexer deployed | Deploy the indexer with rate limiting, backups, replay procedure, and public API health checks. | Infrastructure lead | Done | [Indexer deployment](indexer/deployment.md) |
| Monitoring configured | Configure alerts for RPC health, indexer lag, notification failures, webhook delivery errors, and CI release failures. | Infrastructure lead | Done | [Monitoring configuration](monitoring.md) |
| Backups verified | Restore indexer backup artifacts in a clean environment and document recovery time. | Infrastructure lead | Done | [Indexer backup restore verification](indexer/backup-archive.md#restore-verification) |
| Release provenance verified | Verify npm package provenance and GitHub release artifacts before mainnet announcement. | Release lead | Done | [Provenance audit & procedure](release-process.md#package-provenance-verification-issue-878) |

## Documentation

| Item | Description | Owner | Status | Link |
| --- | --- | --- | --- | --- |
| Local development guide complete | Provide contributor setup for prerequisites, submodules, env vars, Docker Compose, service commands, tests, and OS troubleshooting. | Docs lead | Done | [#300](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/300) |
| Glossary complete | Define protocol terminology for DeFi, invoice factoring, Stellar, governance, security, and notifications. | Docs lead | Done | [#301](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/301) |
# Mainnet Launch Checklist

This checklist tracks the requirements that must be complete before ILN mainnet deployment. Each item has an owner, status, and link to the issue, PR, or document that proves completion.

Status values:

- `Not started`
- `In progress`
- `Blocked`
- `Done`

## Security

| Item | Description | Owner | Status | Link |
| --- | --- | --- | --- | --- |
| External security audit | Complete an external audit of Soroban contracts, upgrade controls, SDK signing paths, indexer APIs, and notification webhooks. | Security lead | Done | [Auditor Onboarding Guide](./auditor-onboarding.md) |
| Coverage thresholds met | Confirm contract, SDK, CLI, indexer, and notifications coverage thresholds pass in CI before release branch freeze. | QA lead | Done | [Coverage workflow](../.github/workflows/coverage.yml) |
| Fuzz tests run | Run fuzz or property-based tests for invoice lifecycle, XDR encoding, amount math, and settlement state transitions. | Protocol lead | Done | [`sdk/src/xdr.test.ts`](../sdk/src/xdr.test.ts) and [`packages/sdk/src/xdr.test.ts`](../packages/sdk/src/xdr.test.ts) |
| Unified security policy | Publish ecosystem-wide reporting, severity, safe-harbour, and response timeline policy across all repositories. | Security lead | Done | [`SECURITY.md`](../SECURITY.md) |
| Bug bounty program launched | Design and launch pre-mainnet bug bounty program defining scope, severity taxonomy, reward tiers, and triage SLA. | Security lead | Done | [Bug Bounty Program](./bug-bounty.md) |

## Contracts

| Item | Description | Owner | Status | Link |
| --- | --- | --- | --- | --- |
| Upgrade path tested | Prove contract upgrade flow works on a local network and testnet without storage collision or authorization regressions. | Protocol lead | Done | [`packages/upgrade-tests`](../packages/upgrade-tests) |
| Multi-sig admin configured | Configure production admin keys with multi-sig, quorum, timelock, and emergency response procedures. | Governance lead | Done | [Governance guide](governance-guide.md#production-multi-sig-admin-configuration) |
| Circuit breaker tested | Exercise pause and recovery paths for funding, settlement, indexing, and notification delivery. | Security lead | Done | [Emergency pause rehearsal](emergency-pause-rehearsal.md) ([#879](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/879)) |
| Mainnet deployment dry run | Run deployment automation against a non-production target and record contract IDs, asset IDs, and rollback notes. | Release lead | Done | [Dry run record](mainnet-deployment-dry-run.md) ([#877](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/877)) |

## Infrastructure

| Item | Description | Owner | Status | Link |
| --- | --- | --- | --- | --- |
| Indexer deployed | Deploy the indexer with rate limiting, backups, replay procedure, and public API health checks. | Infrastructure lead | Done | [Indexer deployment](indexer/deployment.md) |
| Monitoring configured | Configure alerts for RPC health, indexer lag, notification failures, webhook delivery errors, and CI release failures. | Infrastructure lead | Done | [Monitoring configuration](monitoring.md) |
| Backups verified | Restore indexer backup artifacts in a clean environment and document recovery time. | Infrastructure lead | Done | [Indexer backup restore verification](indexer/backup-archive.md#restore-verification) |
| Release provenance verified | Verify npm package provenance and GitHub release artifacts before mainnet announcement. | Release lead | Done | [Provenance audit & procedure](release-process.md#package-provenance-verification-issue-878) |

## Documentation

| Item | Description | Owner | Status | Link |
| --- | --- | --- | --- | --- |
| Local development guide complete | Provide contributor setup for prerequisites, submodules, env vars, Docker Compose, service commands, tests, and OS troubleshooting. | Docs lead | Done | [#300](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/300) |
| Glossary complete | Define protocol terminology for DeFi, invoice factoring, Stellar, governance, security, and notifications. | Docs lead | Done | [#301](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/301) |