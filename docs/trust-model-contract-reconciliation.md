# Trust Model Claims vs Deployed Contract Behavior Reconciliation (#1312)

This document formalizes the authoritative reconciliation between public claims made in `docs/trust-liquidity-model.md` and the actual on-chain behavior of deployed Soroban smart contracts.

---

## 1. Authoritative Reconciliation Matrix

| Architectural Claim in Trust Model | Actual Deployed Soroban Contract Reality | Alignment Status | Invariant Enforcement |
|---|---|---|---|
| **Non-Custodial Escrow** | Invoices fund into per-invoice smart contract storage cells, not shared custodial pools. | **ALIGNED** | `fund_invoice()` locks capital strictly per `invoice_id`. |
| **First-Loss Provision (5%)** | Absorbs first 5% of credit losses upon debtor default. Does **not** provide instant liquidity for LP redemptions. | **ALIGNED** | Credit loss absorption tranche verified; no pooled cash-out mechanism. |
| **Timelocked Anchor Revert** | Settlements unconfirmed by anchor within the 24-hour window allow timelocked release back to funder. | **ALIGNED** | `revert_unsettled_funding()` unlocks escrow after expiry ledger. |
| **Oracle Verification Gating** | Contracts do not execute off-chain KYB natively. Contracts verify signed ed25519 oracle attestations with strict timestamp expiry. | **ALIGNED** | On-chain signature and sequence freshness checks enforced. |
| **Simultaneous LP Redemptions** | Contracts do not implement pooled share tokens (ERC-4626 equivalent). Committed debt cannot be exited before maturity. | **ALIGNED** | Disclosed in Section 6.1; only idle unallocated cash can be withdrawn. |

---

## 2. Invariant Discrepancy Prevention

Automated CI gates continuously cross-check smart contract entry points against trust model assertions to ensure zero behavioral drift between documentation and WASM execution:

```bash
pnpm test:trust-reconciliation
```
