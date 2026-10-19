# Investor-Facing Liquidity Limitation Disclosures (#1314)

This disclosure document establishes formal, investor-facing transparency regarding capital lockup, liquidity limitations, and redemption behavior under normal and stressed market conditions across the Invoice Liquidity Network.

---

## 1. Capital Lockup Invariant

- **Non-Redeemable Committed Principal**: Once LP capital is allocated to fund an approved invoice, that principal is locked in Soroban smart contract escrow until invoice maturity, borrower repayment, or terminal default.
- **No On-Demand Pool Redemptions**: The ILN protocol does not operate a fractional reserve or algorithmic redemption buffer. Committed funds cannot be redeemed on demand.
- **Available vs Committed Liquidity**: Only uncommitted, idle LP capital sitting in the liquidity pool balance is immediately eligible for withdrawal.

---

## 2. Treasury First-Loss Provision Disclosures

- **Credit Loss Coverage Only**: The 5% Treasury First-Loss Provision functions strictly as a credit-loss absorption tranche against verified borrower defaults.
- **Not a Liquidity Reserve**: The First-Loss Provision is **NOT** a liquidity backstop. It cannot be mobilized to fulfill simultaneous LP redemption queues or provide immediate cash-out during a liquidity crunch.

---

## 3. Stressed Liquidity & Redemption Queue Semantics

Under high-severity simultaneous withdrawal stress (as modeled in `docs/trust-liquidity-model.md` Section 6):

1. **Sequential / Pro-Rata Queuing**: When aggregate redemption requests exceed available idle cash, redemptions are queued in arrival order or fulfilled pro-rata based on uncommitted pool balances.
2. **Repayment-Driven Fulfillment**: Queued redemptions are processed progressively as underlying invoice debtors remit principal and fees into the settlement contract.
3. **Secondary Market & Haircut Risks**: The protocol does not guarantee par value for early secondary debt exits. If an LP seeks emergency liquidity via third-party secondary trading, market-driven discount haircuts apply.

---

## 4. Contract Capability Matrix

| Feature | Contract Status | Investor Reality |
|---|---|---|
| **Invoice Funding Escrow** | Deployed | Funds locked strictly until terminal ledger state |
| **Idle Cash Withdrawal** | Supported | Instant withdrawal of unallocated capital |
| **Instant Locked Capital Cashout** | Unsupported | No contract function permits breaking active loan escrows |
| **Emergency Pause Protection** | Supported | Pause halts new originations; does not forfeit LP claims |

---

## 5. Machine-Checkable Enforcement

This disclosure is audited by automated CI validation:
```bash
pnpm test:liquidity-disclosures
```
