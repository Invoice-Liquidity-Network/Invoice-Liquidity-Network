# Docs Setup and Migration Guide

This file covers two things:
1. **Migration checklist** — tracking content from the legacy `docs/` source
   into `packages/docs/` (Nextra 3 / App Router), the canonical deployed site.
2. **Developer setup** — how to run each site locally and how CI/deploy works.

---

## Canonical site and legacy content source

| | `docs/` (legacy content source) | `packages/docs/` (canonical site) |
|---|---|---|
| Package name | `@invoice-liquidity/docs` | `@invoice-liquidity/docs-next` |
| Framework | Nextra 2, Next.js 14, Pages Router (local preview only) | Nextra 3, Next.js 15, App Router |
| Deployed? | **No** | **Yes — docs.iln.finance** |
| CNAME | — | `docs.iln.finance` |
| Built by CI | Not built or deployed as a site | `docs-deploy.yml` builds & deploys `packages/docs/dist` |
| Changelog target | `docs/changelog.md` (auto-committed by `docs-changelog.yml`) | — |
| Content source | `docs/*.md` | `packages/docs/content/*.mdx` |
| Navigation | `_meta.json` — checked by `scripts/check-meta-nav.mjs` | `_meta.ts` — parse-validated by `scripts/validate-canonical-nav.mjs` |

---

## Migration checklist

Track porting each content section from `docs/` to `packages/docs/content/`.
Check a box once the `.mdx` file exists in `packages/docs/content/` and the
page renders correctly on the deployed site.

This checklist is enforced by `node scripts/check-docs-migration.mjs` (run in
the `check-meta-nav` job of `docs-deploy.yml`). The check fails when:

- a ticked item has no `→ packages/docs/content/...` target, the target does
  not exist, or it is not declared in the canonical `_meta.ts` navigation;
- an unticked item's target already exists (ported but not ticked) or its
  `docs/` source has been deleted;
- any `docs/**/*.md` page is missing from this checklist — every legacy page
  must be listed under a content section or under **Not migrating**;
- a ticked "Remove `path`" cleanup item's path still exists;
- an item does not match one of the formats below (fail closed):

```
- [x] Label (`docs/<file>.md` → `packages/docs/content/<file>.mdx`)
- [ ] Label (`docs/<file>.md`)
- `docs/<file>.md` — reason            (only under "Not migrating")
```

### Infrastructure

- [x] Protocol overview (`docs/protocol-overview.md` → `packages/docs/content/protocol-overview.mdx`)
- [x] Smart contract architecture (`docs/architecture.md` → `packages/docs/content/smart-contracts/architecture.mdx`)
- [x] Invoice lifecycle (`docs/contracts/invoice-contract.md` → `packages/docs/content/smart-contracts/invoice-lifecycle.mdx`)
- [x] SDK installation (`docs/sdk-quickstart.md` → `packages/docs/content/sdk-reference/installation.mdx`)
- [x] SDK API reference (`docs/sdk-api-reference.md` → `packages/docs/content/sdk-reference/api-reference.mdx`)
- [x] Governance (`docs/governance-guide.md` → `packages/docs/content/governance/index.mdx`)
- [x] Tutorials — first invoice (`docs/tutorials/first-invoice.md` → `packages/docs/content/tutorials/first-invoice.mdx`)
- [x] Tutorials — LP funding (`docs/tutorials/lp-funding.md` → `packages/docs/content/tutorials/lp-funding.mdx`)
- [x] Frontend integration guide (`docs/integration-guide.md` → `packages/docs/content/frontend-guide/integration.mdx`)
- [x] Horizon API reference (`docs/api-collection.md` → `packages/docs/content/api-reference/horizon.mdx`)
- [x] Notifications API (`docs/notifications.md` → `packages/docs/content/api-reference/notifications.mdx`)
- [x] Soroban RPC reference (`docs/indexer/api-reference.md` → `packages/docs/content/api-reference/soroban-rpc.mdx`)
- [x] Documentation versioning (`docs/versioning.md` → `packages/docs/content/versioning.mdx`)

### Remaining content to port

> **Package names when porting:** use `@iln/sdk` for the stable SDK (`sdk/`)
> and `@iln/sdk-next` for `packages/sdk/`. `packages/docs/content/` is
> scanned by `scripts/check-sdk-package-names.mjs`, so a retired name in a
> ported page fails CI. The SDK pages below (migration guide, E2E, trust
> model, sdk-next notes) were already migrated to the canonical names in
> #1218 and can be ported as-is. See
> [runbooks/sdk-package-names.md](runbooks/sdk-package-names.md).

- [ ] Local development guide (`docs/local-development.md`)
- [ ] CI/CD reference (`docs/ci-cd.md`)
- [x] Security guide (`docs/security-guide.md` → `packages/docs/content/security/security-guide.mdx`)
- [x] Threat model (`docs/threat-model.md` → `packages/docs/content/security/threat-model.mdx`)
- [ ] Glossary (`docs/glossary.md`)
- [ ] Changelog page (`docs/changelog.md`)
- [x] SDK migration guide (`docs/sdk-migration-guide.md` → `packages/docs/content/sdk-reference/migration-guide.mdx`)
- [x] SDK E2E testing guide (`docs/sdk-e2e.md` → `packages/docs/content/sdk-reference/e2e-testing.mdx`)
- [ ] SDK trust model (`docs/sdk-trust-model.md`)
- [ ] SDK next migration notes (`docs/sdk-next-migration.md`)
- [ ] Release process (`docs/release-process.md`)
- [ ] RFC process (`docs/rfc-process.md`)
- [ ] DeFi integrations (`docs/defi-integrations.md`)
- [ ] Protocol economics (`docs/protocol-economics.md`)
- [ ] Stellar primer (`docs/stellar-primer.md`)
- [ ] Multi-token support (`docs/tokens/multi-token-support.md`)
- [ ] Reputation overview (`docs/reputation/overview.md`)
- [ ] Indexer architecture (`docs/indexer/architecture.md`)
- [ ] Indexer configuration (`docs/indexer/configuration.md`)
- [ ] Indexer deployment (`docs/indexer/deployment.md`)
- [ ] Indexer troubleshooting (`docs/indexer/troubleshooting.md`)
- [ ] Contract governance (`docs/contracts/governance-contract.md`)
- [ ] Contract reputation (`docs/contracts/reputation-contract.md`)
- [ ] Mainnet launch checklist (`docs/mainnet-launch-checklist.md`)
- [ ] Troubleshooting guide (`docs/troubleshooting.md`)
- [ ] Analytics (`docs/analytics.md`)
- [ ] Privacy policy (`docs/privacy.md`)
- [ ] Errors reference (`docs/errors.md`)
- [ ] Deployment infrastructure (`docs/deployment/infrastructure.md`)
- [ ] Cross-repo dependencies (`docs/cross-repo-dependencies.md`)
- [ ] Cross-repo sync (`docs/cross-repo-sync.md`)
- [ ] Branch protection policy (`docs/branch-protection.md`)
- [ ] Scripts reference (`docs/scripts.md`)
- [ ] API versioning/migration (`docs/api-versioning-migration.md`)
- [ ] Mutation testing (`docs/mutation-testing.md`)
- [ ] Indexer data model (`docs/indexer-data-model.md`)
- [ ] Indexer overview (`docs/indexer/README.md`)
- [ ] Indexer backup and archive (`docs/indexer/backup-archive.md`)
- [ ] Contract reference index (`docs/contracts/README.md`)
- [ ] Contract ABI compatibility (`docs/contract-abi-compatibility.md`)
- [ ] CLI vs CLI-next (`docs/cli-vs-cli-next.md`)
- [ ] Database migrations (`docs/migrations.md`)
- [ ] Monorepo map (`docs/monorepo-map.md`)
- [ ] Release runbook (`docs/release-runbook.md`)
- [ ] Project board (`docs/project-board.md`)
- [x] Launch communications evidence (`docs/evidence/launch-communications.md` → `packages/docs/content/launch-communications.mdx`)
- [ ] E2E test scope (`docs/e2e-test-scope.md`)
- [ ] Flaky test quarantine (`docs/flaky-test-quarantine.md`)
- [ ] Load test harness (`docs/load-test-harness.md`)
- [ ] Test runtime budgets (`docs/test-runtime-budgets.md`)
- [ ] SDK integration fixture audit (`docs/sdk-integration-fixture-audit.md`)
- [ ] Secrets baseline audit (`docs/secrets-baseline-audit.md`)
- [ ] Credential least-privilege audit (`docs/credential-least-privilege-audit.md`)
- [ ] Vulnerability disclosure (`docs/vulnerability-disclosure.md`)
- [ ] Workers concurrency audit (`docs/workers-concurrency-audit.md`)
- [ ] SDK API Compatibility Matrix (`docs/SDK_COMPATIBILITY_MATRIX.md`)
- [ ] Release Audit — 2026-10-01 (`docs/audit/release-audit-2026-10-01.md`)
- [ ] External Auditor Onboarding Package (`docs/auditor-onboarding.md`)
- [ ] Backup Retention and Encryption-at-Rest Audit (`docs/backup-encryption-audit.md`)
- [ ] Bug Bounty Program (`docs/bug-bounty.md`)
- [ ] Canary Deployment & Automated Rollback issue #1095 (`docs/canary-deployment.md`)
- [ ] CDN / Edge-Caching Strategy for the Indexer Public Read API (`docs/cdn-edge-caching.md`)
- [ ] CI Duration & Cost Audit (`docs/ci-duration-cost-audit.md`)
- [ ] CLI function-level comparison audit (`docs/cli-function-level-audit.md`)
- [ ] Mainnet Launch Communications & Community Plan (`docs/community-announcement.md`)
- [ ] Compliance audit integrity (`docs/compliance-audit-integrity.md`)
- [ ] Cost Attribution (`docs/cost-attribution.md`)
- [ ] Cross-Repo Incident-Escalation Drill Report (`docs/cross-repo-incident-escalation-drill.md`)
- [ ] Cross-Service Payload Over-Fetching Audit (`docs/cross-service-payload-audit.md`)
- [ ] Dependency audit escalation policy (`docs/dependency-audit-escalation.md`)
- [ ] Dependency Confusion and Typosquatting Audit (`docs/dependency-confusion-audit.md`)
- [ ] Indexer Backup/Restore Drill — How to run (`docs/drills/README-indexer-drill.md`)
- [ ] Indexer Backup/Restore Drill — 2026-10-01 (`docs/drills/indexer-backup-restore-drill-2026-10-01.md`)
- [ ] Emergency Pause / Unpause Rehearsal Issue #879 (`docs/emergency-pause-rehearsal.md`)
- [ ] Multi-Service Outage Game-Day Report #1105 (`docs/game-days/2026-09-multi-service-outage-game-day.md`)
- [ ] RPC-Node Outage System Drill Report #1107 (`docs/game-days/2026-09-rpc-node-outage-drill.md`)
- [ ] Cross-Repo Game-Day Exercise #1 Execution Report (`docs/game-days/cross-repo-exercise-01.md`)
- [ ] Hardening Batch Coordination & Cross-Repo Sync Protocol (`docs/hardening-batch-coordination.md`)
- [ ] Main-Repo Incident Response Runbook (`docs/incident-response.md`)
- [ ] Indexer Cursor Divergence Operator Recovery Runbook Issue #1269 (`docs/indexer/cursor-divergence-recovery.md`)
- [ ] Multi-Region Indexer Failover Plan (`docs/indexer/failover-plan.md`)
- [ ] Knip dead-code enforcement (`docs/knip-enforcement.md`)
- [ ] Local development guide validation log (`docs/local-development-validation.md`)
- [ ] Mainnet Deployment Dry Run Issue #877 (`docs/mainnet-deployment-dry-run.md`)
- [ ] Operational Monitoring & Grafana Observability (`docs/monitoring.md`)
- [ ] Notification Rate Limiting Runbook (`docs/notifications-rate-limiting.md`)
- [ ] Oracle Service (`docs/oracle-service.md`)
- [ ] Oracle Source Failover & Delta-Bound Review Runbook Issues #1051, #1052 (`docs/oracle-source-failover-runbook.md`)
- [ ] Postmortem: Game-Day #1 Oracle Cache Malfunction & Badge State Mismatch (`docs/postmortems/2026-08-30-cross-repo-game-day-oracle-malfunction.md`)
- [ ] Automated Data-Loss & Integrity Detection Coverage #1108 (`docs/postmortems/DATA_LOSS_DETECTION_COVERAGE.md`)
- [ ] Shared Cross-Repo Postmortem Process Guide (`docs/postmortems/PROCESS.md`)
- [ ] Shared Cross-Repo Postmortem Repository (`docs/postmortems/README.md`)
- [ ] Postmortem: [Incident Title] (`docs/postmortems/TEMPLATE.md`)
- [ ] Reproducible Builds Issue #1078 (`docs/reproducible-builds.md`)
- [ ] Runbook: E2E environment ownership and credential rotation (`docs/runbooks/e2e-environment-ownership.md`)
- [ ] Runbook: E2E prerequisites fail-closed lifecycle verification (`docs/runbooks/e2e-prerequisites.md`)
- [ ] Runbook: E2E release evidence bundle (`docs/runbooks/e2e-release-evidence.md`)
- [ ] Runbook: Example SDK Resolution (`docs/runbooks/example-sdk-resolution.md`)
- [ ] Runbook: Generated-Client Drift Detection (`docs/runbooks/generated-client-drift.md`)
- [ ] Cross-Repo Incident Response Runbook (`docs/runbooks/incident-response.md`)
- [ ] Indexer Reorg Reconciliation & Event Idempotency Runbook (`docs/runbooks/indexer-reorg-reconciliation.md`)
- [ ] Runbook: notification dispatch outcomes and recipient protection (`docs/runbooks/notifications-dispatch-outcomes.md`)
- [ ] Payer Authorization Failures Runbook (`docs/runbooks/payer-authorization-failures.md`)
- [ ] Runbook: Payer Cryptographic Signature Verification (`docs/runbooks/payer-signature-verification.md`)
- [ ] Runbook: Payer Substitution Rejection Across Lifecycle States (`docs/runbooks/payer-substitution-rejection.md`)
- [ ] Runbook: @iln/react Peer-Dependency Contract (`docs/runbooks/react-peer-contract.md`)
- [ ] Runbook: SDK Export Map Consistency (`docs/runbooks/sdk-export-maps.md`)
- [ ] Runbook: Canonical SDK Package Names (`docs/runbooks/sdk-package-names.md`)
- [ ] Runbook: SDK Release-Candidate Pack Smoke (`docs/runbooks/sdk-rc-smoke.md`)
- [ ] Runbook: Security Documentation and API Security Headers (`docs/runbooks/security-docs.md`)
- [ ] Runbook: SDK Versioning and Support Windows (`docs/runbooks/sdk-support-windows.md`)
- [ ] ILN SCF Technical Narrative (`docs/scf-technical-narrative.md`)
- [ ] Cross-repo SDK Trust Model visibility (`docs/sdk-trust-model-cross-repo.md`)
- [ ] SDK Trust Model Verification Checklist (`docs/sdk-trust-verification-checklist.md`)
- [ ] SDK Versioning and Support Windows (`docs/sdk-versioning.md`)
- [ ] Security Audit Findings & CI Blocking Configuration — Issue #891 (`docs/security-audit-report.md`)
- [ ] Service Level Objectives SLOs & Service Level Indicators SLIs (`docs/slos.md`)
- [ ] SLSA Provenance Generation & Verification Issue #1077 (`docs/slsa-provenance.md`)
- [ ] Third-Party Data-Processor Inventory and DPA Review (`docs/third-party-data-processor-inventory.md`)
- [ ] Trust & Liquidity Model Version 1.0 (`docs/trust-liquidity-model.md`)

### Not migrating

- `docs/README.md` — repository-browsing index for `docs/`; the canonical site has its own landing page
- `docs/index.md` — legacy Nextra 2 home page, superseded by `packages/docs/content/index.mdx`
- `docs/DOCS_SETUP.md` — this maintainer guide; removed with the legacy site
- `docs/CHANGELOG_IMPLEMENTATION.md` — implementation notes for the changelog workflow, not reader-facing
- `docs/security.md` — redirect stub to the root `SECURITY.md`

### Post-migration cleanup

- [ ] Remove `docs/pages/` directory (Nextra 2 Pages Router entry)
- [ ] Remove `docs/components/AlgoliaSearch.tsx` (or port to `packages/docs`)
- [ ] Remove `docs/theme.config.jsx` (Nextra 2 theme)
- [ ] Remove `docs/next.config.js` (Nextra 2 Next.js config)
- [ ] Remove `docs/tsconfig.json` (Nextra 2 TypeScript config)
- [ ] Remove `docs/package.json` and `@invoice-liquidity/docs` from workspace
- [ ] Remove `docs/.env.example` (Algolia keys, superseded by packages/docs setup)
- [ ] Configure Algolia DocSearch for `packages/docs` (see setup section below)
- [ ] Update `docs-deploy.yml` to drop the `docs/**` path trigger once `docs/` is content-only
- [ ] Archive or redirect `docs/algolia-crawler-config.json` to `packages/docs/`
- [ ] Update this file (remove migration checklist, keep dev guide only)

---

## Developer setup

### Mainnet launch readiness and evidence

Run [`check-mainnet-launch-readiness.mjs`](../scripts/check-mainnet-launch-readiness.mjs) to validate owner metadata, freshness, reviewer independence, and local evidence links. Run [`validate-mainnet-launch-evidence.mjs`](../scripts/validate-mainnet-launch-evidence.mjs) to verify every checklist row has a repository-local verification artifact and no legacy SDK API reference remains. Pull-request CI runs both structural checks and their regression tests in the [Mainnet Launch Readiness workflow](../.github/workflows/mainnet-launch-readiness.yml); the independent audit gate runs in the [Mainnet Launch Evidence workflow](../.github/workflows/mainnet-launch-evidence.yml).

Before launch, dispatch the [Mainnet Launch Readiness workflow](../.github/workflows/mainnet-launch-readiness.yml) for the checklist rehearsal and the [Mainnet Launch Evidence workflow](../.github/workflows/mainnet-launch-evidence.yml) for the audit gate. The rehearsal requires every checklist row to be `Done` or `Launch exception accepted` and fresh independent reviewer sign-offs. The audit gate requires a complete independent external audit covering the manifest's required scope, no unresolved findings (or documented accepted findings), completion within the last 365 days, and a downloadable HTTPS report whose SHA-256 matches [`docs/evidence/external-security-audit.json`](evidence/external-security-audit.json). Both gates fail closed and publish JSON/summary evidence. The Release lead owns checklist and manifest updates and recovery.

This control changes no adjacent service API or cross-repository package contract; it consumes existing repository documentation and CI artifacts only.

### Canonical site — `packages/docs/` (deployed to `docs.iln.finance`)

```bash
# From repo root
pnpm --filter @invoice-liquidity/docs-next dev
# Runs at http://localhost:3000

pnpm --filter @invoice-liquidity/docs-next build
# Produces packages/docs/dist/ — same bundle CI deploys
```

### Legacy local preview — `docs/` (not deployed)

```bash
# From repo root
pnpm --filter @invoice-liquidity/docs dev
# Optional local preview of the legacy source; not the deployed documentation site.
# Runs at http://localhost:3000

pnpm --filter @invoice-liquidity/docs build
# Optional local validation of the Nextra 2 source
```

---

## CI / deploy flow

`docs-deploy.yml` runs on every push to `main` and on every PR that touches
`packages/docs/**` or `docs/**`:

| Trigger | `build` job | `deploy` job |
|---|---|---|
| `push` to `main` | Runs (`packages/docs/`) | Runs — publishes `packages/docs/dist` to GitHub Pages |
| `pull_request` | Runs — fails PR if build breaks | Skipped (never publishes from PRs) |
| `workflow_dispatch` | Runs | Runs — manual publish |

`docs-changelog.yml` runs on every push to `main` and on `v*.*.*` tags. It
calls `.local/repo-ops/aggregate-changelogs.js`, writes the result to
`docs/changelog.md`, and auto-commits it. This means `docs/changelog.md` is
always regenerated in the legacy site; once the changelog page is ported to
`packages/docs/content/`, this workflow should be updated to target the new
location.

---

## Algolia DocSearch setup (for `packages/docs/`)

1. Apply at [docsearch.algolia.com](https://docsearch.algolia.com/) using the
   site URL `https://docs.iln.finance`.
2. Once approved, add credentials to `packages/docs/.env.local`:
   ```
   NEXT_PUBLIC_ALGOLIA_APP_ID=<your_app_id>
   NEXT_PUBLIC_ALGOLIA_API_KEY=<your_search_api_key>
   NEXT_PUBLIC_ALGOLIA_INDEX_NAME=iln-docs
   ```
3. Apply `docs/algolia-crawler-config.json` in the Algolia Crawler dashboard.
   The config was audited in July 2026 and updated for the Nextra 3 App Router
   URL structure — selectors now target `<main>` (not `<article>`) and
   sub-heading records are extracted for granular search results.
4. Run the Algolia crawler after the first post-migration deploy.

> **Sitemap gap:** `packages/docs` uses `output: 'export'` without a sitemap
> plugin, so no `sitemap.xml` is generated. The crawler config uses
> `discoveryPatterns` for URL discovery instead. Once `next-sitemap` is added
> to `packages/docs`, restore the `sitemaps` entry in
> `docs/algolia-crawler-config.json`.
>
> **Credentials:** `docs/algolia-crawler-config.json` contains placeholder
> `appId`/`apiKey` values. Replace them with real DocSearch credentials in the
> Algolia dashboard — do not commit real credentials to the repo.
