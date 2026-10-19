# Pooled-Share Redemption Guarantees & Exclusions Specification (#1305)

This operational specification defines legal and technical redemption guarantees and explicit non-guarantees for Liquidity Providers in the Invoice Liquidity Network.

## 1. Formal Redemption Guarantees

1. **Immediate Par Fulfillment for Idle Cash**: Uncommitted cash is guaranteed 100% redeemable on-demand at par ($1.00 USD/share).
2. **Deterministic FIFO Queue Ordering**: Redemption amounts exceeding idle reserves receive an immutable, timestamped ticket fulfilled chronologically as repayments arrive.
3. **Pro-Rata Loss Parity**: Unfulfilled queue tickets remain exposed to proportional default impairments; no early-exit priority exists over shared credit risk.
4. **Non-Dilution Invariant**: Share minting and burning must execute strictly at or above real-time NAV.

## 2. Explicit Non-Guarantees (Exclusions)

- **No Breakable Escrow**: Capital deployed into active invoice escrows cannot be redeemed before loan maturity.
- **No Secondary Market Peg**: The protocol does not maintain an automated peg or market-maker liquidity for early secondary sales.

## 3. Verification

```bash
pnpm test:pooled-guarantees
```
