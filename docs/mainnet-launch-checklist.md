# Mainnet Launch Checklist

This checklist tracks the requirements that must be verified before ILN mainnet deployment. Each item has an owner, a planning status, a context link, and a repository-local verification artifact. Status alone never establishes launch readiness.

Status values:

- `Not started`
- `In progress`
- `Blocked`
- `Done`
- `Launch exception accepted`

## Security

| Item | Description | Owner | Status | Link | Verification artifact |
| --- | --- | --- | --- | --- | --- |
| External security audit | Complete an independent external audit of Soroban contracts, upgrade controls, SDK signing paths, indexer APIs, and notification webhooks; resolve or explicitly accept all findings. | Security lead | Not started | [Audit tracking issue](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/new) | [Audit evidence manifest](evidence/external-security-audit.json) |
| Coverage thresholds met | Confirm contract, SDK, CLI, indexer, and notifications coverage thresholds pass in CI before release branch freeze. | QA lead | In progress | [Coverage workflow](../.github/workflows/coverage.yml) | [Coverage workflow](../.github/workflows/coverage.yml) |
| Fuzz tests run | Run fuzz or property-based tests for invoice lifecycle, XDR encoding, amount math, and settlement state transitions. | Protocol lead | In progress | [`packages/sdk/src/xdr.test.ts`](../packages/sdk/src/xdr.test.ts) | [SDK XDR tests](../packages/sdk/src/xdr.test.ts) |
| Unified security policy | Publish ecosystem-wide reporting, severity, safe-harbour, and response timeline policy. | Security lead | In progress | [Security policy](../SECURITY.md) | [Security policy](../SECURITY.md) |

## Contracts

| Item | Description | Owner | Status | Link | Verification artifact |
| --- | --- | --- | --- | --- | --- |
| Upgrade path tested | Prove contract upgrade flow works on a local network and testnet without storage collision or authorization regressions. | Protocol lead | In progress | [`packages/upgrade-tests`](../packages/upgrade-tests) | [Upgrade test package](../packages/upgrade-tests) |
| Multi-sig admin configured | Configure production admin keys with multi-sig, quorum, timelock, and emergency response procedures. | Governance lead | Not started | [Governance guide](governance-guide.md) | [Governance guide](governance-guide.md) |
| Circuit breaker tested | Exercise pause and recovery paths for funding, settlement, indexing, and notification delivery. | Security lead | Not started | [Security policy](security.md) | [Security policy](security.md) |
| Mainnet deployment dry run | Run deployment automation against a non-production target and record contract IDs, asset IDs, and rollback notes. | Release lead | Not started | [Deployment guide](../DEPLOYMENT_GUIDE.md) | [Deployment guide](../DEPLOYMENT_GUIDE.md) |

## Infrastructure

| Item | Description | Owner | Status | Link | Verification artifact |
| --- | --- | --- | --- | --- | --- |
| Indexer deployed | Deploy the indexer with rate limiting, backups, replay procedure, and public API health checks. | Infrastructure lead | In progress | [Indexer deployment](indexer/deployment.md) | [Indexer deployment runbook](indexer/deployment.md) |
| Monitoring configured | Configure alerts for RPC health, indexer lag, notification failures, webhook delivery errors, and CI release failures. | Infrastructure lead | In progress | [Upptime workflow](../.github/workflows/upptime.yml) | [Upptime workflow](../.github/workflows/upptime.yml) |
| Backups verified | Restore indexer backup artifacts in a clean environment and document recovery time. | Infrastructure lead | Not started | [Infrastructure deployment](deployment/infrastructure.md) | [Infrastructure recovery runbook](deployment/infrastructure.md) |
| Release provenance verified | Verify npm package provenance and GitHub release artifacts before mainnet announcement. | Release lead | In progress | [Security provenance](security.md#package-provenance) | [Security guide](security-guide.md) |

## Documentation

| Item | Description | Owner | Status | Link | Verification artifact |
| --- | --- | --- | --- | --- | --- |
| Local development guide complete | Provide contributor setup for prerequisites, submodules, env vars, Docker Compose, service commands, tests, and OS troubleshooting. | Docs lead | In progress | [Local development guide](local-development.md) | [Local development guide](local-development.md) |
| Glossary complete | Define protocol terminology for DeFi, invoice factoring, Stellar, governance, security, and notifications. | Docs lead | In progress | [Glossary](glossary.md) | [Glossary](glossary.md) |
| API and SDK guides complete | Confirm SDK, CLI, indexer, and notification API docs match current package behavior. | SDK lead | In progress | [Canonical SDK API reference](../packages/docs/content/sdk-reference/api-reference.mdx) | [Canonical SDK API reference](../packages/docs/content/sdk-reference/api-reference.mdx) |
| Mainnet checklist maintained | Keep this checklist linked from the root README and update statuses as referenced issues close. | Release lead | In progress | [Checklist status workflow](../.github/workflows/mainnet-checklist-status.yml) | [Checklist status workflow](../.github/workflows/mainnet-checklist-status.yml) |

## Community

| Item | Description | Owner | Status | Link | Verification artifact |
| --- | --- | --- | --- | --- | --- |
| CONTRIBUTING current | Confirm contribution workflow, branch expectations, tests, and security reporting guidance are current. | Maintainers | In progress | [`CONTRIBUTING.md`](../CONTRIBUTING.md) | [Contribution guide](../CONTRIBUTING.md) |
| SECURITY current | Confirm root security policy and docs security page are aligned. | Security lead | In progress | [`SECURITY.md`](../SECURITY.md) | [Security policy](../SECURITY.md) |
| CHANGELOG current | Confirm release notes describe mainnet readiness changes and any breaking changes. | Release lead | In progress | [`CHANGELOG.md`](../CHANGELOG.md) | [Changelog](../CHANGELOG.md) |
| Community announcement prepared | Prepare launch announcement, support channels, incident contact, and maintainer availability plan. | Community lead | Not started | [Launch communications evidence](evidence/launch-communications.md) | [Launch communications evidence](evidence/launch-communications.md) |

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
