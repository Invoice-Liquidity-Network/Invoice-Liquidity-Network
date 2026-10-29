# Hardening Batch Coordination & Cross-Repo Sync Protocol

## Overview

The Invoice Liquidity Network protocol is executing three concurrent 125-issue hardening batches across its three primary repositories:

- 🏠 **[Invoice-Liquidity-Network](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network)** (main repo: SDK, CLI, Indexer, Notifications, Oracle-Service)
- ⚙️ **[ILN-Smart-Contract](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract)** (Soroban smart contracts in Rust)
- 🖥️ **[ILN-Frontend](https://github.com/Invoice-Liquidity-Network/ILN-Frontend)** (Next.js dApp & UI components)

Because features span across backend services, smart contracts, and user interfaces, contributors picking up issues across repositories risk creating duplicate, conflicting, or contradictory implementations. This document establishes the formal coordination process, domain authority mappings, and de-duplication rules to ensure cross-batch alignment.

---

## Domain Authority Mappings

To prevent overlapping issues from diverging or creating duplicate implementations, each functional domain has a single **authoritative repository**. Issues in non-authoritative repos must reference and build upon the authoritative repo's implementation rather than speculatively reimplementing logic.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        HARDENING BATCH DOMAINS                         │
├───────────────────┬──────────────────────────────────┬─────────────────┤
│ Domain            │ Authoritative Repo               │ Scope           │
├───────────────────┼──────────────────────────────────┼─────────────────┤
│ Indexer           │ 🏠 Invoice-Liquidity-Network     │ Engine & Schema │
│ Notifications     │ 🏠 Invoice-Liquidity-Network     │ Service & Webhooks│
│ Oracle (Off-Chain)│ 🏠 Invoice-Liquidity-Network     │ Fetcher & Feeder│
│ Oracle (On-Chain) │ ⚙️ ILN-Smart-Contract            │ Soroban Contract│
│ UI & Client Views │ 🖥️ ILN-Frontend                  │ Next.js & React │
└───────────────────┴──────────────────────────────────┴─────────────────┘
```

### 1. Indexer Hardening

- **Authoritative Repo**: 🏠 `Invoice-Liquidity-Network` (`indexer/` service & `packages/indexer/` library).
- **Rules**:
  - `Invoice-Liquidity-Network` defines event log schemas, Soroban RPC polling parameters, database migrations, and REST/GraphQL API endpoints.
  - `ILN-Frontend` indexer issues (e.g. speculative UI hooks or client-side caching) **must consume** the `Invoice-Liquidity-Network` Indexer API and must not create standalone or parallel indexer services.
  - `ILN-Smart-Contract` event format changes must be coordinated with `Invoice-Liquidity-Network`'s indexer parser before landing.

### 2. Notifications Service

- **Authoritative Repo**: 🏠 `Invoice-Liquidity-Network` (`notifications/` service).
- **Rules**:
  - `Invoice-Liquidity-Network` is authoritative for webhook dispatch, HMAC signing (`X-ILN-Signature`), retry backoff logic, and WebSocket push channels.
  - `ILN-Frontend` notification components (toast messages, notification centers) are client consumers of the notification WebSocket/REST APIs.
  - `ILN-Smart-Contract` event triggers (e.g. `InvoiceFunded`, `InvoiceDefaulted`) define the payload events dispatched by `notifications/`.

### 3. Oracle Integration & Hardening

- **Authoritative Repo (On-Chain)**: ⚙️ `ILN-Smart-Contract` (`contracts/oracle` or contract storage).
  - Soroban contract interfaces, price storage, timestamp verification, and on-chain quorum checks are authoritative in `ILN-Smart-Contract`.
- **Authoritative Repo (Off-Chain)**: 🏠 `Invoice-Liquidity-Network` (`oracle-service/`).
  - Off-chain price fetching, signature generation, feeder scripts, and RPC submission logic are authoritative in `Invoice-Liquidity-Network`.
- **Authoritative Repo (UI)**: 🖥️ `ILN-Frontend`.
  - Displaying oracle feed status, staleness indicators, and price history graphs is authoritative in `ILN-Frontend`.

---

## De-Duplication & Linkage Protocol

When identical or closely related issues exist across multiple repositories:

1. **Identify Authoritative Issue**: Determine which repository owns the primary implementation per the Domain Authority Mappings above.
2. **Apply `sync:*` Labels**: Label the primary issue in `Invoice-Liquidity-Network` with the appropriate label:
   - `sync:smart-contract` for smart contract dependencies
   - `sync:frontend` for frontend dependencies
   - `sync:all` for cross-cutting protocol issues
3. **Link Duplicate Items**: Cross-reference the issue numbers explicitly in issue descriptions and PR descriptions (e.g., `Depends on Invoice-Liquidity-Network#123` or `Related to ILN-Smart-Contract#45`).
4. **Close True Duplicates**: If an issue in a sibling repo is a complete duplicate of work owned by the main repo's issue, close the duplicate in favor of tracking the synced issue generated via `sync-issues.yml`.

---

## Cross-Repo Hardening Checklist for Contributors

Before opening a PR for a hardening batch issue:

- [ ] Check if the issue touches Indexer, Notifications, or Oracle subsystems.
- [ ] Verify that your proposed changes align with the authoritative repository's specifications.
- [ ] Ensure any contract ABI or payload changes update shared types in `packages/shared/`.
- [ ] Include cross-repo issue references (`Invoice-Liquidity-Network#XXX`, `ILN-Smart-Contract#YYY`, `ILN-Frontend#ZZZ`) in your PR description.
