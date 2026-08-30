# External Auditor Onboarding Package

Welcome to the Invoice Liquidity Network audit onboarding. This document serves as the top-level guided entry point for external auditors, tying together the audit materials across all three core repositories.

## 1. Smart Contracts
The core on-chain logic resides in the smart contracts repository. 
- Please start with the **Guided Reading Order** (located in the contract repository's `docs/guided-reading-order.md`) to understand the contract architecture and dependencies.
- Track current audit readiness and remediations in the **Audit-Readiness Dashboard** (located in the contract repository).

## 2. Frontend / Client Application
The user-facing application handles interactions with the contracts and wallets.
- Review the **Wallet-Security-Focused Document** (located in the frontend repository) to understand how we secure wallet connections, transaction signing, and key management.

## 3. Core Network / Infrastructure (This Repository)
This repository hosts the network infrastructure, indexer, oracle services, and SDKs.
- **SDK Trust Model**: Understand the assumptions and trust boundaries of our SDKs by reviewing the SDK trust model documentation.
- **Oracle Service**: Dive into the oracle design and data verification logic in our oracle-service documentation.
- **Audit-Remediation Status**: Review this repository's current audit readiness and remediation status.

---
*Note: This umbrella document is designed to streamline the auditor review process by centralizing our security postures, trust models, and known remediation states across the entire Invoice Liquidity Network ecosystem.*
