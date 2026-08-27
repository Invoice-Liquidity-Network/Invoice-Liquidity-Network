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
| External security audit | Complete an external audit of Soroban contracts, upgrade controls, SDK signing paths, indexer APIs, and notification webhooks. | Security lead | Not started | [#887](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/887) |
| Coverage thresholds met | Confirm contract, SDK, CLI, indexer, and notifications coverage thresholds pass in CI before release branch freeze. | QA lead | In progress | [Coverage workflow](../.github/workflows/coverage.yml) |
| Fuzz tests run | Run fuzz or property-based tests for invoice lifecycle, XDR encoding, amount math, and settlement state transitions. | Protocol lead | In progress | [`packages/sdk/src/xdr.test.ts`](../packages/sdk/src/xdr.test.ts) |
| Unified security policy | Publish ecosystem-wide reporting, severity, safe-harbour, and response timeline policy across all repositories. | Security lead | Done | [`SECURITY.md`](../SECURITY.md) |

## Contracts

| Item | Description | Owner | Status | Link |
| --- | --- | --- | --- | --- |
| Upgrade path tested | Prove contract upgrade flow works on a local network and testnet without storage collision or authorization regressions. | Protocol lead | In progress | [`packages/upgrade-tests`](../packages/upgrade-tests) |
| Multi-sig admin configured | Configure production admin keys with multi-sig, quorum, timelock, and emergency response procedures. | Governance lead | Done | [Governance guide](governance-guide.md#production-multi-sig-admin-configuration) |
| Circuit breaker tested | Exercise pause and recovery paths for funding, settlement, indexing, and notification delivery. | Security lead | Not started | [Security policy](security.md) |
| Mainnet deployment dry run | Run deployment automation against a non-production target and record contract IDs, asset IDs, and rollback notes. | Release lead | Not started | [Deployment guide](../DEPLOYMENT_GUIDE.md) |

## Infrastructure

| Item | Description | Owner | Status | Link |
| --- | --- | --- | --- | --- |
| Indexer deployed | Deploy the indexer with rate limiting, backups, replay procedure, and public API health checks. | Infrastructure lead | In progress | [Indexer deployment](indexer/deployment.md) |
| Monitoring configured | Configure alerts for RPC health, indexer lag, notification failures, webhook delivery errors, and CI release failures. | Infrastructure lead | Done | [Monitoring configuration](monitoring.md) |
| Backups verified | Restore indexer backup artifacts in a clean environment and document recovery time. | Infrastructure lead | Not started | [Infrastructure deployment](deployment/infrastructure.md) |
| Release provenance verified | Verify npm package provenance and GitHub release artifacts before mainnet announcement. | Release lead | In progress | [Security provenance](security.md#package-provenance) |

## Documentation

| Item | Description | Owner | Status | Link |
| --- | --- | --- | --- | --- |
| Local development guide complete | Provide contributor setup for prerequisites, submodules, env vars, Docker Compose, service commands, tests, and OS troubleshooting. | Docs lead | In progress | [#300](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/300) |
| Glossary complete | Define protocol terminology for DeFi, invoice factoring, Stellar, governance, security, and notifications. | Docs lead | In progress | [#301](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/301) |
| API and SDK guides complete | Confirm SDK, CLI, indexer, and notification API docs match current package behavior. | SDK lead | In progress | [SDK API reference](sdk-api-reference.md) |
| Mainnet checklist maintained | Keep this checklist linked from the root README and update statuses as referenced issues close. | Release lead | In progress | [#298](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/298) |

## Community

| Item | Description | Owner | Status | Link |
| --- | --- | --- | --- | --- |
| CONTRIBUTING current | Confirm contribution workflow, branch expectations, tests, and security reporting guidance are current. | Maintainers | In progress | [`CONTRIBUTING.md`](../CONTRIBUTING.md) |
| SECURITY current | Confirm root security policy and docs security page are aligned. | Security lead | In progress | [`SECURITY.md`](../SECURITY.md) |
| CHANGELOG current | Confirm release notes describe mainnet readiness changes and any breaking changes. | Release lead | In progress | [`CHANGELOG.md`](../CHANGELOG.md) |
| Community announcement prepared | Prepare launch announcement, support channels, incident contact, and maintainer availability plan. | Community lead | Done | [Community announcement](community-announcement.md) |

## Automatic Status Updates

The [`Mainnet Checklist Status`](../.github/workflows/mainnet-checklist-status.yml) workflow scans links in this file when an issue is closed or when maintainers run it manually. If a row links to a closed issue in this repository, the workflow changes that row's status to `Done` and opens a pull request with the generated update.

Rows linked to documents, workflows, external repositories, or new-issue templates still require manual maintainer review.

## Maintainer Sign-off

Mainnet launch requires sign-off from the core maintainers below after every checklist item is `Done` or has an explicitly accepted launch exception.

| Role | Maintainer | Signature | Date |
| --- | --- | --- | --- |
| Protocol lead | TBD |  |  |
| Security lead | TBD |  |  |
| Infrastructure lead | TBD |  |  |
| SDK lead | TBD |  |  |
| Release lead | TBD |  |  |
| Community lead | TBD |  |  |
