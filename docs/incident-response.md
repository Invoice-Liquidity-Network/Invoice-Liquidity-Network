# Main-Repo Incident Response Runbook

This document defines the operational incident response runbook for the **Invoice Liquidity Network (ILN) Core Repository**, which hosts the **TypeScript SDK**, **Indexer Service**, **Notifications Service**, and **Oracle Service**.

Because both the **Soroban Smart Contracts (`backend`)** and the **Web Application (`frontend`)** depend directly on these core services and libraries, an incident originating in this repository has a protocol-wide blast radius that neither dependent repository's runbook can fully contain on its own.

---

## 1. Cross-Repo Escalation & Ownership Matrix

Incidents in the main repository frequently intersect with contract execution and frontend user interfaces. The table below establishes clear component ownership and escalation paths across all three repositories:

| Incident Type | Primary Escalation Owner | Impacted Downstream Repos | Immediate Containment Action | Cross-Repo Link |
| --- | --- | --- | --- | --- |
| **SDK Compromise** (malicious npm package, XDR mutation) | SDK Lead / Security Team | `frontend`, third-party integrators | Deprecate npm version, publish security advisory, enforce SLSA attestation verification | [Frontend Runbook](https://github.com/Invoice-Liquidity-Network/ILN-Frontend/blob/main/docs/incident-response.md#step-2-emergency-vercel-rollback-sev-1-mitigation) |
| **Indexer Data Loss / Corruption** | Infrastructure Lead | `frontend`, analytics dashboards | Switch frontend to direct Soroban RPC read mode, restore SQLite WAL backup | [Frontend Runbook](https://github.com/Invoice-Liquidity-Network/ILN-Frontend/blob/main/docs/incident-response.md#step-1-execute-feature-flag-kill-switches) |
| **Oracle-Service Compromise** | Security Lead & Governance Lead | `backend`, `frontend` | Disable oracle feature flag in frontend (`NEXT_PUBLIC_ORACLE_ENABLED=false`), trigger contract fallback mode | [Contract Policy](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/blob/main/docs/security.md#oracle-integration--manipulation) |
| **Notifications Abuse** (SSRF, Webhook flood) | Backend Services Lead | Integrator webhooks, user channels | Rotate HMAC signing keys, enforce IP blocklist, trip service circuit breaker | [Security Policy](../SECURITY.md#severity-classification) |
| **Contract-Level Emergency** (drained escrow, reentrancy) | Smart Contract Lead | `backend`, `frontend` | Trigger contract pause via admin multisig | [Contract Reentrancy Matrix](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/blob/main/docs/security.md#reentrancy-analysis-issue-535) |

### Emergency Notification Channels
- **Security Lead / Incident Commander**: `@sec-commander` / `security@invoiceliquidity.network`
- **Frontend Lead**: `@frontend-leads` (coordinates UI feature flags & Vercel rollbacks)
- **Contract Lead**: `@contract-leads` (coordinates Soroban contract pause/unpause)
- **Infrastructure Lead**: `@infra-leads` (manages indexer & notifications deployments)

---

## 2. Incident Severity Classification

| Level | Impact Description | Core Component Examples |
| --- | --- | --- |
| **SEV-1 (Critical)** | Active loss of funds, compromised SDK package on npm, corrupted ledger data leading to wrong payouts, or rogue Oracle responses. | - Malicious SDK package published to npm.<br>- Oracle service returning forged high trust scores for fraudulent payers.<br>- Database corruption causing false invoice status reporting across all users. |
| **SEV-2 (High)** | Degradation of core infrastructure services without direct loss of funds; notification service SSRF or unauthorized webhook relay. | - Indexer sync lag exceeding 100 ledgers.<br>- Webhook delivery SSRF vulnerability exploited to probe internal endpoints.<br>- Unhandled RPC rate-limiting blocking event ingestion. |
| **SEV-3 (Medium/Low)** | Non-critical service outage, isolated notification delivery failure, minor metrics API gap. | - SMS/Email provider quota exhaustion.<br>- Transient WebSocket connection drops.<br>- Indexer `/v1/stats` endpoint returning stale cache. |

---

## 3. Incident Scenarios & Response Procedures

### Scenario A: SDK Compromise or Supply-Chain Poisoning

#### 1. Blast Radius & Hop-by-Hop Trust Boundary
As documented in the [Protocol Threat Model](./threat-model.md#1-sdk-threat-surface) and [Security Guide](./security-guide.md#security-overview), the SDK sits between user input and wallet transaction signing:
`User Input → App UI → SDK Transaction Builder → Wallet Signing (Freighter) → Soroban RPC`.

A compromised SDK package (e.g. via stolen npm credentials or malicious transitive dependency) can inject forged XDR envelopes, alter target contract addresses, or substitute recipient keys prior to user signature.

#### 2. Containment & Remediation Workflow
1. **Unpublish / Deprecate Compromised NPM Releases**:
   ```bash
   # Deprecate the compromised package version immediately on npm registry
   npm deprecate @invoice-liquidity/sdk@<COMPROMISED_VERSION> "CRITICAL SECURITY ADVISORY: Do not use this version. Upgrade to patched release."
   ```
2. **Verify SLSA Level 3 Provenance Attestation**:
   Compare published artifact digests against GitHub Actions build attestations to confirm clean release hashes:
   ```bash
   gh attestation verify sdk-package.tgz --repo Invoice-Liquidity-Network/Invoice-Liquidity-Network
   ```
3. **Notify Downstream Consumers & Frontend Team**:
   - Instruct the **Frontend Team** to execute an emergency deployment pinning a verified safe SDK version ([Frontend Runbook Procedures](https://github.com/Invoice-Liquidity-Network/ILN-Frontend/blob/main/docs/incident-response.md#step-2-emergency-vercel-rollback-sev-1-mitigation)).
   - Issue an advisory instructing third-party integrators to verify lockfile integrity (`pnpm-lock.yaml`) and check package signatures via `npm audit signatures @invoice-liquidity/sdk`.
4. **Publish Clean Patch Release**:
   Publish a patched version built exclusively via automated CI (`.github/workflows/sdk-release.yml`) with updated SLSA attestations.

---

### Scenario B: Indexer Data-Loss or State Corruption

#### 1. Blast Radius
The indexer parses Soroban event streams to populate the REST API (`/v1/invoice/:id`, `/v1/stats`) and frontend dashboards. An indexer database crash, storage corruption, or missed ledger window causes stale or inaccurate protocol state reporting to users.

#### 2. Restoration & Recovery Workflow
1. **Switch Downstream Frontend to Direct On-Chain Read Mode**:
   If indexer data is corrupted, instruct the Frontend Lead to set `NEXT_PUBLIC_INDEXER_ENABLED=false` so the web app falls back to querying the Soroban RPC directly for authoritative state.
2. **Isolate & Stop Corrupted Indexer Service**:
   ```bash
   # Stop the running indexer process
   systemctl stop iln-indexer
   ```
3. **Restore SQLite WAL Backup**:
   Locate the latest verified SQLite snapshot (managed via `scripts/monitor.sh` and database backup routines):
   ```bash
   # Backup corrupted file for forensic investigation
   mv indexer.db indexer_corrupted_$(date +%s).sqlite

   # Restore latest clean snapshot
   cp /var/backups/iln/indexer_last_good.sqlite indexer.db
   ```
4. **Reconcile Ledger Cursor & Resync**:
   Inspect the last synced ledger marker in the restored database and restart the indexer with resynchronization enabled:
   ```bash
   # Verify database integrity
   sqlite3 indexer.db "PRAGMA quick_check;"

   # Restart service to resume catch-up sync from Horizon / Soroban RPC
   systemctl start iln-indexer
   ```
5. **Verify Indexer Data Integrity**:
   Run the synthetic canary check to ensure indexer REST endpoints return valid status:
   ```bash
   pnpm exec tsx scripts/synthetic-canary.ts
   ```

---

### Scenario C: Oracle-Service Compromise or Malfunction

#### 1. Blast Radius
The `oracle-service` assesses payer addresses and returns credit scores and verification markers (`/v1/verify`). A compromised or malfunctioning oracle service could return inflated trust scores for fraudulent payers or fail during invoice funding checks.

#### 2. Containment & Remediation Workflow
1. **Trigger Frontend Oracle Kill-Switch**:
   Instruct the Frontend Team to immediately disable live oracle verification via feature flag:
   ```bash
   # Disable oracle checks in frontend deployment
   vercel env add NEXT_PUBLIC_ORACLE_ENABLED production false
   vercel --prod
   ```
   *(See [Frontend Incident Response Runbook](https://github.com/Invoice-Liquidity-Network/ILN-Frontend/blob/main/docs/incident-response.md#step-1-execute-feature-flag-kill-switches)).*
2. **Purge Poisoned Oracle Cache**:
   If the oracle service cache contains manipulated payer reputation records, purge the internal cache:
   ```bash
   # Send cache purge command to oracle service API
   curl -X POST http://localhost:3010/v1/admin/purge-cache \
     -H "Authorization: Bearer ${ORACLE_ADMIN_SECRET}"
   ```
3. **Audit Smart Contract Fallback Mode**:
   Confirm that the Soroban contract's static bounds fallback is active. Per [backend/docs/security.md#oracle-integration--manipulation](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/blob/main/docs/security.md#oracle-integration--manipulation), smart contracts do not depend solely on off-chain oracle prices for accounting and enforce safety limits natively.
4. **Rotate Oracle Signing Keys & Update On-Chain Registry**:
   If oracle private key compromise is suspected:
   - Rotate oracle keypair in secret manager.
   - Submit a governance proposal or admin multisig transaction to update the oracle registry on-chain ([ADR-010 Oracle Registry](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/blob/main/docs/adr/ADR-010-oracle-registry.md)).

---

### Scenario D: Notifications Service Abuse (SSRF / Webhook Spam)

#### 1. Blast Radius
The notifications service processes user subscriptions and dispatches webhooks, emails, and SMS alerts upon invoice state changes. Attackers may attempt Server-Side Request Forgery (SSRF) via malicious webhook URLs (`/subscribe`), send webhook spam, or exhaust SMS/email budgets.

#### 2. Containment & Remediation Workflow
1. **Activate Circuit Breaker & Clamping**:
   If webhook delivery targets are attacking internal endpoints or failing repeatedly:
   ```bash
   # Trigger emergency webhook pause via service admin endpoint
   curl -X POST http://localhost:4001/admin/circuit-breaker/trip \
     -H "Authorization: Bearer ${NOTIFICATIONS_ADMIN_SECRET}"
   ```
2. **Rotate Webhook HMAC Signing Secret**:
   If webhook secret leakage is suspected, rotate the secret to invalidate unverified dispatches:
   ```bash
   # Update WEBHOOK_HMAC_SECRET in production environment
   export WEBHOOK_HMAC_SECRET="$(openssl rand -hex 32)"
   systemctl restart iln-notifications
   ```
3. **Apply Domain Blocklist for SSRF Mitigation**:
   Update `BLOCKED_DOMAINS` to reject private IP ranges (`10.0.0.0/8`, `192.168.0.0/16`, `127.0.0.1`, `metadata.google.internal`):
   ```env
   DISALLOWED_WEBHOOK_HOSTS=localhost,127.0.0.1,169.254.169.254,0.0.0.0,::1
   ```
4. **Flush Poisoned Job Queue**:
   Purge pending outbound notification jobs from the queue if spam amplification is detected.

---

## 4. Post-Incident Review & Cross-Repo Sync

Following containment of any SEV-1 or SEV-2 incident:

1. **Post-Mortem Timeline**: Conduct a joint post-mortem within 72 hours involving representatives from `main`, `backend`, and `frontend` teams.
2. **Cross-Repo Verification**:
   - Run synthetic canary checks: `pnpm exec tsx scripts/synthetic-canary.ts`.
   - Run end-to-end integration tests across contract, SDK, and frontend packages.
3. **Public Advisory & Attribution**: Publish a coordinated GitHub Security Advisory per our root [SECURITY.md](../SECURITY.md) guidelines and credit reporting researchers in `HALL_OF_FAME.md`.

---

## 5. Related Incident Response Runbooks

- **Smart Contract Security & Reentrancy Policy**: [`backend/docs/security.md`](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/blob/main/docs/security.md)
- **Frontend Incident Response Runbook**: [`frontend/docs/incident-response.md`](https://github.com/Invoice-Liquidity-Network/ILN-Frontend/blob/main/docs/incident-response.md)
- **Repository Security Policy**: [`SECURITY.md`](../SECURITY.md)
- **Protocol Threat Model**: [`docs/threat-model.md`](./threat-model.md)
- **Security Guide**: [`docs/security-guide.md`](./security-guide.md)
