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
| API and SDK guides complete | Confirm SDK, CLI, indexer, and notification API docs match current package behavior. | SDK lead | Done | [SDK API reference](sdk-api-reference.md) |
| Mainnet checklist maintained | Keep this checklist linked from the root README and update statuses as referenced issues close. | Release lead | Done | [#298](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/298) |

## Community

| Item | Description | Owner | Status | Link |
| --- | --- | --- | --- | --- |
| CONTRIBUTING current | Confirm contribution workflow, branch expectations, tests, and security reporting guidance are current. | Maintainers | Done | [`CONTRIBUTING.md`](../CONTRIBUTING.md) |
| SECURITY current | Confirm root security policy and docs security page are aligned. | Security lead | Done | [`SECURITY.md`](../SECURITY.md) |
| CHANGELOG current | Confirm release notes describe mainnet readiness changes and any breaking changes. | Release lead | Done | [`CHANGELOG.md`](../CHANGELOG.md) |
| Community announcement prepared | Prepare launch announcement, support channels, incident contact, and maintainer availability plan. | Community lead | Done | [Community announcement](community-announcement.md) |

## Automatic Status Updates

The [`Mainnet Checklist Status`](../.github/workflows/mainnet-checklist-status.yml) workflow scans links in this file when an issue is closed or when maintainers run it manually. If a row links to a closed issue in this repository, the workflow changes that row's status to `Done` and opens a pull request with the generated update.

Rows linked to documents, workflows, external repositories, or new-issue templates still require manual maintainer review.

## Maintainer Sign-off

Mainnet launch requires sign-off from the core maintainers below after every checklist item is `Done` or has an explicitly accepted launch exception.

| Role | Maintainer | Signature | Date |
| --- | --- | --- | --- |
| Protocol lead | @Greymantron | Confirmed | August 30, 2026 |
| Security lead | @Greymantron | Confirmed | August 30, 2026 |
| Infrastructure lead | @Greymantron | Confirmed | August 30, 2026 |
| SDK lead | @Greymantron | Confirmed | August 30, 2026 |
| Release lead | @Greymantron | Confirmed | August 30, 2026 |
| Community lead | @Greymantron | Confirmed | August 30, 2026 |

## Final Coordinated Cross-Repo Sign-off

This final reconciliation pass ensures that readiness across all three core repositories (Contracts, Frontend, Infrastructure) is confirmed and mutually consistent.

- [x] **Smart Contracts Readiness**: Audit remediations resolved. Maintainer Sign-off confirmed on August 25, 2026.
- [x] **Frontend & Client Readiness**: Wallet security & PII handling verified. Maintainer Sign-off confirmed on August 26, 2026.
- [x] **Infrastructure & Network**: Privacy policy, Trust & Liquidity model, and Auditor package published.

By checking the box below and recording the date, the maintainers confirm that the Invoice Liquidity Network is formally ready for mainnet deployment and external auditing.

- [x] **Final Org-Level Sign-off**: All cross-repo readiness milestones are confirmed.
  - **Maintainer(s)**: @Greymantron
  - **Date**: August 30, 2026
