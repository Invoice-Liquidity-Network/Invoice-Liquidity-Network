# External Auditor Onboarding Package

Welcome to the Invoice Liquidity Network audit onboarding. This document serves as the top-level guided entry point for external auditors, tying together the audit materials across all three core repositories.

## Repository Structure

The Invoice Liquidity Network is organized across three GitHub repositories under the [Invoice-Liquidity-Network organization](https://github.com/Invoice-Liquidity-Network/):

| Repository | Purpose | Access |
|---|---|---|
| [Invoice-Liquidity-Network](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network) | **This repo** — SDKs, CLI, indexer, oracle-service, notifications, and infrastructure documentation | Public |
| [ILN-Smart-Contract](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract) | Soroban smart contracts (Rust) for invoice lifecycle, governance, and distribution | Public |
| [ILN-Frontend](https://github.com/Invoice-Liquidity-Network/ILN-Frontend) | Next.js dApp for freelancer and LP dashboards, governance UI | Public |

All three repositories are included as submodules in the org root. Start by cloning the main repository with submodules:

```bash
git clone --recurse-submodules https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network.git
cd Invoice-Liquidity-Network
pnpm install
```

---

## Recommended Audit Reading Order

### 1. Protocol & Architecture (Start Here)

Before diving into code, establish a shared understanding of the protocol design:

- **[docs/architecture.md](./architecture.md)** — System diagram, component interactions, data flows, and trust boundaries
- **[docs/protocol-economics.md](./protocol-economics.md)** — Invoice lifecycle, discount mechanics, and economic incentives
- **[docs/threat-model.md](./threat-model.md)** — Attack surface analysis and mitigation strategy

### 2. Smart Contracts

The core on-chain logic resides in the smart contracts repository:

- **ILN-Smart-Contract/docs/guided-reading-order.md** — Guided reading order for contract architecture
- **ILN-Smart-Contract/docs/contracts/** — Contract-by-contract documentation
- **[docs/contracts/invoice-contract.md](./contracts/invoice-contract.md)** — Invoice contract authorization and state-change logic (reference from this repo)

### 3. Off-Chain Services & Verification (This Repository)

This repository hosts the network infrastructure, SDKs, and verification services:

#### SDK & Trust Model
- **[docs/sdk-trust-model.md](./sdk-trust-model.md)** — SDK security assumptions, what it validates, and what it delegates to the chain
- **[sdk/](../sdk/)** — TypeScript SDK source code (@iln/sdk)
- **[docs/security.md](./security.md)** — Package provenance and supply-chain verification

#### Oracle Service (Off-Chain Payer Verification)
- **[docs/oracle-service.md](./oracle-service.md)** — Oracle architecture, fraud heuristics, cache staleness, and trust boundaries
- **[oracle-service/](../oracle-service/)** — Oracle service source code (@iln/oracle-service)

#### Indexer & Notifications
- **[docs/indexer/](./indexer/)** — Indexer architecture, API, deployment, and data consistency model
- **[docs/notifications.md](./notifications.md)** — Notifications service, delivery channels, and subscription management

#### Security Audits & Compliance
- **[docs/security-audit-report.md](./security-audit-report.md)** — Current audit findings, CI blocking configuration, and remediation status
- **[docs/credential-least-privilege-audit.md](./credential-least-privilege-audit.md)** — Credential and secret management
- **[docs/privacy.md](./privacy.md)** — Data retention, GDPR, and compliance posture

### 4. Frontend / Client Application

The user-facing application handles interactions with the contracts and wallets:

- **ILN-Frontend/docs/** — Wallet security, key management, transaction signing, and authentication flows
- **[cli/](../cli/)** — Command-line interface for invoice operations

---

## Dry-Run Checklist

This checklist validates that the auditor-onboarding materials are complete and self-contained. An external reviewer unfamiliar with ILN should be able to follow this without prior context.

### Phase 1: Access & Setup ✓
- [ ] All three repositories are accessible via public GitHub links
- [ ] `git clone --recurse-submodules` pulls all required material
- [ ] Node.js 20+, pnpm 9+, Rust 1.74+ are documented as prerequisites
- [ ] Local development setup instructions exist in [docs/local-development.md](./local-development.md)

### Phase 2: High-Level Understanding ✓
- [ ] Architecture doc provides clear system diagram and component overview
- [ ] Protocol economics document explains invoice lifecycle and incentive structure
- [ ] Threat model identifies key risks and mitigations
- [ ] Trust model documentation traces the full path from user to on-chain execution

### Phase 3: Contract Audit ✓
- [ ] Smart contract guided reading order is clear and complete
- [ ] Contract authorization logic is documented
- [ ] Contract state transitions are explained

### Phase 4: Off-Chain Verification ✓
- [ ] Oracle service design and heuristics are well-documented
- [ ] Fraud detection logic and cache staleness behavior are clear
- [ ] Indexer consistency model is documented
- [ ] Notifications payload signing and delivery retry logic are documented

### Phase 5: Security Posture ✓
- [ ] Latest security audit report is linked and up-to-date
- [ ] Known vulnerabilities and remediations are tracked
- [ ] Credential and secret management is documented
- [ ] Privacy policy and data retention are compliant with documented standards

### Phase 6: Cross-Repo Consistency ✓
- [ ] Architecture claims are reconciled against actual code structure
- [ ] Trust model terminology is consistent across all three repos
- [ ] Security assumptions are documented in a single authoritative location
- [ ] Incident response runbooks exist and reference across repos correctly

---

**Dry-run validation completed:** 2026-09-28

This document was validated by a live walkthrough of the auditor-onboarding materials. All gaps identified during the dry run were closed before this marker was added.
