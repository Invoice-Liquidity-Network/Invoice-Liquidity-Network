# Circuit-Breaker Activation and Recovery Controls (#1307)

This runbook establishes operational controls and state-machine transitions for liquidity and settlement-anchor circuit breakers across the Invoice Liquidity Network.

## Invariant State Model

1. **CLOSED (Healthy)**: All transactions route normally. Failures increment `consecutiveFailures`.
2. **OPEN (Tripped)**: Activated when `consecutiveFailures >= 5` or error rate > 5%. Blocks all new settlement assignments; auto-reverts to secondary fallback anchors.
3. **HALF_OPEN (Probing)**: After a configurable cool-off window, admits single canary transactions to test upstream provider recovery.
4. **RESET (All-Clear)**: Requires 3 consecutive successful probe settlements to transition back to `CLOSED`.

## Verification

```bash
pnpm test:circuit-breaker
```
