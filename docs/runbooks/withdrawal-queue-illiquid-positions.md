# Withdrawal Queue Behavior for Illiquid Positions (#1303)

This operational specification defines redemption queue behavior when liquidity pool assets contain overdue, defaulted, or illiquid invoice loans.

## Invariant Protections

1. **Anti-Bank-Run Pro-Rata Gating**: When a pool holds illiquid debt, redeeming LPs cannot drain 100% cash at par. Each withdrawal receives a proportional split of performing cash and illiquid exposure.
2. **Contingent Recovery Receipts (CRRs)**: Unfulfillable illiquid loan principal converts into audited sidecar receipts.
3. **Pro-Rata Workout Recovery**: Off-chain legal or debt restructuring recoveries disburse pro-rata across all outstanding CRRs.

## Verification

```bash
pnpm test:illiquid-queue
```
