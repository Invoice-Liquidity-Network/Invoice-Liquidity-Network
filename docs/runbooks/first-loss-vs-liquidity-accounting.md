# First-Loss vs Liquidity Reserve Accounting Specification (#1306)

This specification mandates complete accounting isolation between protocol credit protection provisions and user liquidity redemption reserves.

## Invariant Guarantees

1. **Dedicated Account Separation**:
   - `TreasuryFirstLossAccount`: Capital dedicated strictly to credit-loss coverage.
   - `PoolLiquidityReserveAccount`: Idle capital dedicated strictly to LP redemptions and loan funding.
2. **Zero Cross-Draining**:
   - LP redemptions cannot tap First-Loss capital under any market condition.
   - Borrower defaults cannot reduce the Pool Liquidity Reserve.
3. **Audit Trail**: Every ledger state transition records untouched balances of adjacent accounts.

## Validation

```bash
pnpm test:accounting-isolation
```
