# Mainnet Launch Checklist

This checklist tracks the requirements that must be verified before ILN mainnet deployment. Each item has an owner, a planning status, a context link, and a repository-local verification artifact. Status alone never establishes launch readiness.

Checklist owner: Release lead
Last reviewed: 2026-10-19
Freshness window: 30 days

Status values:

- `Not started`
- `In progress`
- `Blocked`
- `Done`
- `Launch exception accepted`

## Security

| Item | Description | Owner | Status | Link | Verification artifact |
| --- | --- | --- | --- | --- | --- |
| External security audit | Complete an independent external audit of Soroban contracts, upgrade controls, SDK signing paths, indexer APIs, and notification webhooks; resolve or explicitly accept all findings. | Security lead | Blocked | [Auditor Onboarding Guide](./auditor-onboarding.md) | [Audit evidence manifest](evidence/external-security-audit.json) |
| Coverage thresholds met | Confirm contract, SDK, CLI, indexer, and notifications coverage thresholds pass in CI before release branch freeze. | QA lead | Done | [Coverage workflow](../.github/workflows/coverage.yml) | [Coverage workflow](../.github/workflows/coverage.yml) |
| Fuzz tests run | Run fuzz or property-based tests for invoice lifecycle, XDR encoding, amount math, and settlement state transitions. | Protocol lead | Done | [`sdk/src/xdr.test.ts`](../sdk/src/xdr.test.ts) and [`packages/sdk/src/xdr.test.ts`](../packages/sdk/src/xdr.test.ts) | [SDK XDR tests](../packages/sdk/src/xdr.test.ts) |
| Unified security policy | Publish ecosystem-wide reporting, severity, safe-harbour, and response timeline policy across all repositories. | Security lead | Done | [`SECURITY.md`](../SECURITY.md) | [Security policy](../SECURITY.md) |

## Contracts

| Item | Description | Owner | Status | Link | Verification artifact |
| --- | --- | --- | --- | --- | --- |
| Upgrade path tested | Prove contract upgrade flow works on a local network and testnet without storage collision or authorization regressions. | Protocol lead | Done | [`packages/upgrade-tests`](../packages/upgrade-tests) | [Upgrade test package](../packages/upgrade-tests) |
| Multi-sig admin configured | Configure production admin keys with multi-sig, quorum, timelock, and emergency response procedures. | Governance lead | Done | [Governance guide](governance-guide.md#production-multi-sig-admin-configuration) | [Governance guide](governance-guide.md) |
| Circuit breaker tested | Exercise pause and recovery paths for funding, settlement, indexing, and notification delivery. | Security lead | Done | [Emergency pause rehearsal](emergency-pause-rehearsal.md) ([#879](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/879)) | [Emergency pause rehearsal](emergency-pause-rehearsal.md) |
| Mainnet deployment dry run | Run deployment automation against a non-production target and record contract IDs, asset IDs, and rollback notes. | Release lead | Done | [Dry run record](mainnet-deployment-dry-run.md) ([#877](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/877)) | [Dry run record](mainnet-deployment-dry-run.md) |

## Infrastructure

| Item | Description | Owner | Status | Link | Verification artifact |
| --- | --- | --- | --- | --- | --- |
| Indexer deployed | Deploy the indexer with rate limiting, backups, replay procedure, and public API health checks. | Infrastructure lead | Done | [Indexer deployment](indexer/deployment.md) | [Indexer deployment runbook](indexer/deployment.md) |
| Monitoring configured | Configure alerts for RPC health, indexer lag, notification failures, webhook delivery errors, and CI release failures. | Infrastructure lead | Done | [Monitoring configuration](monitoring.md) | [Monitoring configuration](monitoring.md) |
| Backups verified | Restore indexer backup artifacts in a clean environment and document recovery time. | Infrastructure lead | Done | [Indexer backup restore verification](indexer/backup-archive.md#restore-verification) | [Backup restore verification](indexer/backup-archive.md#restore-verification) |
| Release provenance verified | Verify npm package provenance and GitHub release artifacts before mainnet announcement. | Release lead | Done | [Provenance audit & procedure](release-process.md#package-provenance-verification-issue-878) | [Provenance procedure](release-process.md#package-provenance-verification-issue-878) |

## Documentation

| Item | Description | Owner | Status | Link | Verification artifact |
| --- | --- | --- | --- | --- | --- |
| Local development guide complete | Provide contributor setup for prerequisites, submodules, env vars, Docker Compose, service commands, tests, and OS troubleshooting. | Docs lead | Done | [#300](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/300) | [Local development guide](local-development.md) |
| Glossary complete | Define protocol terminology for DeFi, invoice factoring, Stellar, governance, security, and notifications. | Docs lead | Done | [#301](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/301) | [Glossary](glossary.md) |
| API and SDK guides complete | Confirm SDK, CLI, indexer, and notification API docs match current package behavior. | SDK lead | Done | [Canonical SDK API reference](../packages/docs/content/sdk-reference/api-reference.mdx) | [Canonical SDK API reference](../packages/docs/content/sdk-reference/api-reference.mdx) |
| Mainnet checklist maintained | Keep this checklist linked from the root README and update statuses as referenced issues close. | Release lead | Done | [#298](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/298) | [Checklist status workflow](../.github/workflows/mainnet-checklist-status.yml) |

## Community

| Item | Description | Owner | Status | Link | Verification artifact |
| --- | --- | --- | --- | --- | --- |
| CONTRIBUTING current | Confirm contribution workflow, branch expectations, tests, and security reporting guidance are current. | Maintainers | Done | [`CONTRIBUTING.md`](../CONTRIBUTING.md) | [Contribution guide](../CONTRIBUTING.md) |
| SECURITY current | Confirm root security policy and docs security page are aligned. | Security lead | Done | [`SECURITY.md`](../SECURITY.md) | [Security policy](../SECURITY.md) |
| CHANGELOG current | Confirm release notes describe mainnet readiness changes and any breaking changes. | Release lead | Done | [`CHANGELOG.md`](../CHANGELOG.md) | [Changelog](../CHANGELOG.md) |
| Community announcement prepared | Prepare launch announcement, support channels, incident contact, and maintainer availability plan. | Community lead | Done | [Community announcement](community-announcement.md) | [Community announcement](community-announcement.md) |

## Automatic Status Updates

The [`Mainnet Checklist Status`](../.github/workflows/mainnet-checklist-status.yml) workflow scans links in this file when an issue is closed or when maintainers run it manually. If a row links to a closed issue in this repository, the workflow changes that row's status to `Done` and opens a pull request with the generated update.

The workflow only updates planning status; it does not establish launch readiness. Each row must link to a repository-local verification artifact. The readiness workflow checks every artifact path and ignores `Done` when deciding whether launch evidence is valid.

## Maintainer Sign-off

Mainnet launch requires completed evidence for every checklist row, a current independent external audit, resolved or explicitly accepted audit findings, and maintainer sign-off below. Planning status is not a launch gate.

| Role | Maintainer | Signature | Date |
| --- | --- | --- | --- |
| Protocol lead | @Greymantron | Confirmed | August 30, 2026 |
| Security lead | @Greymantron | Confirmed | August 30, 2026 |
| Infrastructure lead | @Greymantron | Confirmed | August 30, 2026 |
| SDK lead | @Greymantron | Confirmed | August 30, 2026 |
| Release lead | @Greymantron | Confirmed | August 30, 2026 |
| Community lead | @Greymantron | Confirmed | August 30, 2026 |

Independent reviewer sign-off is separate from maintainer attestation. Reviewers must not own checklist items; the readiness rehearsal requires each review area to have a named independent reviewer with a current `Signed` decision.

| Role | Reviewer | Relationship | Sign-off | Date |
| --- | --- | --- | --- | --- |
| Protocol lead | TBD | Independent | Pending | TBD |
| Security lead | TBD | Independent | Pending | TBD |
| Infrastructure lead | TBD | Independent | Pending | TBD |
| SDK lead | TBD | Independent | Pending | TBD |
| Release lead | TBD | Independent | Pending | TBD |
| Community lead | TBD | Independent | Pending | TBD |

## Launch Evidence Gate

Run `node scripts/validate-mainnet-launch-evidence.mjs` to verify checklist artifact links and canonical API references. Before launch, dispatch the `Mainnet Launch Evidence` workflow. It downloads the independent auditor's HTTPS report, enforces the 365-day freshness limit and required audit scope, verifies its SHA-256 digest, and fails closed on unavailable or mismatched evidence. CI uploads a JSON report and writes findings, owner, and recovery instructions to the workflow summary.

The Release lead owns recovery. Complete `docs/evidence/external-security-audit.json` only after the independent audit is published; record the completion date, full required scope, finding disposition, immutable HTTPS artifact URL, and SHA-256 digest. Do not mark the audit complete using a placeholder or a test artifact.

## Final Coordinated Cross-Repo Sign-off

This final reconciliation pass ensures that readiness across all three core repositories (Contracts, Frontend, Infrastructure) is confirmed and mutually consistent.

- [x] **Smart Contracts Readiness**: Audit remediations resolved. Maintainer Sign-off confirmed on August 25, 2026.
- [x] **Frontend & Client Readiness**: Wallet security & PII handling verified. Maintainer Sign-off confirmed on August 26, 2026.
- [x] **Infrastructure & Network**: Privacy policy, Trust & Liquidity model, and Auditor package published.

This section records cross-repository maintainer attestations; its checkboxes do not authorize launch. The evidence workflow and current external audit manifest are the authoritative launch gate.

- [x] **Final Org-Level Sign-off**: Cross-repo readiness attestations recorded; launch remains subject to the evidence gate.
  - **Maintainer(s)**: @Greymantron
  - **Date**: August 30, 2026
