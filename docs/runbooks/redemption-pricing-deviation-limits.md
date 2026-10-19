# Redemption Pricing Deviation Limits Runbook (#1310)

This operational specification governs pricing bounds, discount caps, and front-running protection for LP redemptions under normal and stressed market environments.

## 1. Deviation Guardrails

| Condition | Maximum Allowed Deviation vs NAV | Action on Breach |
|---|---|---|
| **Normal Operations** | ≤ 2.0% | Reject quote (`EXCESSIVE_PRICING_DEVIATION`) |
| **Stressed Liquidity Mode** | ≤ 5.0% | Reject quote (`EXCESSIVE_PRICING_DEVIATION`) |
| **Stale Oracle Feeds (> 60s)** | Any | Hard fail-closed (`STALE_ORACLE_PRICE`) |

## 2. Invariant Protections

- **Anti-Predatory Exit**: Protects exiting LPs from predatory secondary execution haircuts exceeding 5.0%.
- **Anti-Arbitrage Dump**: Protects passive pool LPs by applying recognized credit impairments prior to calculating redemption payouts.

## 3. Verification

```bash
pnpm test:redemption-pricing
```
