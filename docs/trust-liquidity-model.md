# Trust & Liquidity Model (Version 1.0)
**Date:** August 30, 2026

This document represents the finalized Trust & Liquidity Model for the Invoice Liquidity Network, explicitly addressing the reviewer feedback from the initial internal design phase. It serves as a permanent, versioned public record of our architectural decisions.

## Reviewer Feedback & Final Decisions

### 1. Target Market Focus
- **Reviewer Question**: The initial draft was too broad regarding the target market. Who are the initial borrowers and what is the specific geographic focus?
- **Final Decision**: We are exclusively targeting SME suppliers based in emerging markets (primarily LATAM and Southeast Asia) interacting with US-based enterprise buyers. This minimizes currency volatility risk on the buyer side while maximizing the impact of early liquidity for suppliers.

### 2. KYB Provider Integration
- **Reviewer Question**: How will business identity and corporate risk be assessed at scale without bottlenecking liquidity?
- **Final Decision**: We will integrate with an established, regulated external KYB provider. Their API provides the necessary corporate structure unrolling and ultimate beneficial owner (UBO) verification required by our initial Liquidity Providers, without storing sensitive PII natively on our infrastructure (see [Privacy Policy](./privacy.md)).

### 3. LP Cold-Start Posture
- **Reviewer Question**: How do we guarantee initial liquidity before a proven track record is established?
- **Final Decision**: We will deploy a "First-Loss Provision" managed via a dedicated treasury multi-sig during the cold-start phase. This provides a buffer for external LPs, ensuring that the first 5% of any default is absorbed by the protocol's treasury, drastically lowering the risk threshold for onboarding initial institutional capital.

### 4. Settlement Anchor Partner
- **Reviewer Question**: Which fiat-on/off ramp will handle the final mile settlement, and what are their SLA guarantees?
- **Final Decision**: We have selected regulated stablecoin issuers (like Circle for USDC) combined with Stellar Anchor Network members for local currency disbursement. This dual-anchor strategy guarantees near-instant USD-equivalent settlement while providing localized rails for SMEs who prefer native fiat.

---
*These decisions mark the conclusion of the Trust & Liquidity Model design phase and will govern the v1 mainnet deployment.*
