# Stressed Liquidity Redemption Simulation Runbook (#1313)

This operational specification defines the execution parameters and validation criteria for stress-testing liquidity redemption queues under liquidity crunches.

## 1. Simulation Invariants

1. **Idle Cash Priority**: Immediate payouts can never exceed current idle unallocated cash (`idleRatio * totalPoolCapital`).
2. **Locked Capital Protection**: Active loan escrow principal cannot be liquidated to satisfy immediate redemptions.
3. **Queue Invariant**: Queued redemptions strictly drain via incoming debtor repayments.
4. **Deterministic Fulfillment**: At 25% severity, immediate fulfillment is 100%; at 50% it is 80%; at 75% it is 53.3%; at 100% it is 40% (assuming 40% idle cash).

## 2. Automated Benchmark Execution

```bash
pnpm test:liquidity-stress
```
